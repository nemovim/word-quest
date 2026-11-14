import { appendFile } from 'node:fs/promises';

import { OpenRouter } from '@openrouter/sdk';
import mongoose from 'mongoose';

import { examplePipeline, nextBatchSize, readExampleOptions } from './batch-options.ts';
import { saveGeneratedExamples } from './example-storage.ts';
import { createLogFile } from './log-file.ts';
import { queueDeferredExample } from '../src/lib/server/deferred-example.ts';
import {
	reviewExamplesWithLuna,
	type ExampleReviewResult
} from '../src/lib/server/example-luna-review.ts';
import { resolveGenerationModel } from '../src/lib/server/model-config.ts';
import { decodeHtmlEntities } from '../src/lib/shared/utils/html-entity.util.ts';
import { isEnglishLexemeSurface } from '../src/lib/shared/utils/lexeme.util.ts';

const BATCH_SIZE = 10;
const EXAMPLES_PER_VOCA = 3;

type VocaInput = {
	_id: mongoose.Types.ObjectId;
	originKey: string;
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: string;
	targetLang: string;
	targetText: string;
	targetDefinition: string;
	utilityScore: number;
};

type GenerationInput = Omit<VocaInput, '_id' | 'originKey' | 'utilityScore'> & { index: number };

type GeneratedExample = {
	sourceSentence: string;
	sourceAnswer: string;
	targetSentence: string;
	targetAnswer: string;
	targetPronunciation: string;
	targetPronunciationArpabet?: string;
};

type GeneratedItem = {
	index: number;
	examples: GeneratedExample[];
};

type GeneratedResponse = {
	items: GeneratedItem[];
};

type UsageSummary = {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost: number;
};

const VALIDATION_FAILURES = [
	'EMPTY_FIELD',
	'SOURCE_NOT_FOUND_ONCE',
	'INVALID_SOURCE_FORM',
	'TARGET_NOT_FOUND_ONCE',
	'INVALID_TARGET_FORM'
] as const;

type ValidationFailure = (typeof VALIDATION_FAILURES)[number];
type ValidationFailureCounts = Record<ValidationFailure, number>;

type ValidatedGeneration = {
	payload: GeneratedResponse;
	generatedExampleCount: number;
	rejectionCounts: ValidationFailureCounts;
};

const KOREAN_PARTICLES = [
	'으로부터',
	'에게서',
	'한테서',
	'께서',
	'에서',
	'에게',
	'한테',
	'처럼',
	'까지',
	'부터',
	'으로',
	'이나',
	'라도',
	'마저',
	'보다',
	'하고',
	'랑',
	'와',
	'과',
	'을',
	'를',
	'은',
	'는',
	'이',
	'가',
	'의',
	'에',
	'도',
	'만',
	'로',
	'나'
] as const;

function requireEnvironment(name: 'MONGO_URI' | 'OPENROUTER_API_KEY'): string {
	const value = process.env[name]?.trim();

	if (value == null || value === '') {
		throw new Error(`${name} is required.`);
	}

	return value;
}

function readJsonContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.map((item) =>
				typeof item === 'object' && item != null && 'text' in item && typeof item.text === 'string'
					? item.text
					: ''
			)
			.join('');
	}

	return '';
}

function buildDeveloperPrompt(): string {
	return [
		'Return JSON only.',
		`Generate ${EXAMPLES_PER_VOCA} natural bilingual Korean and specified target-language quiz examples for each vocabulary item; return fewer only when another valid example cannot be produced.`,
		'Each pair must use the supplied lexemes in the supplied senses, express the same situation in both languages, and be idiomatic and grammatically correct.',
		'Use only grammar-required inflections and do not replace either lexeme.',
		'Return sourceAnswer and targetAnswer as the exact sentence substrings to hide.',
		'Use Korean noun items as nouns, never as 하다 predicates; sourceAnswer is the unchanged headword with any particle left outside. For predicates, use the complete conjugated form.',
		'Keep every index unchanged and return it exactly once.',
		'Return an object shaped as {"items":[{"index":0,"examples":[{"sourceSentence":"...","sourceAnswer":"...","targetSentence":"...","targetAnswer":"..."}]}]}.'
	].join(' ');
}

function isHangul(value: string): boolean {
	return /^\p{Script=Hangul}$/u.test(value);
}

function isParticleSequence(value: string): boolean {
	if (value === '') {
		return true;
	}

	const reachable = new Set([0]);

	for (let index = 0; index < value.length; index += 1) {
		if (!reachable.has(index)) {
			continue;
		}

		for (const particle of KOREAN_PARTICLES) {
			if (value.startsWith(particle, index)) {
				reachable.add(index + particle.length);
			}
		}
	}

	return reachable.has(value.length);
}

function hasValidKoreanBoundary(sentence: string, answer: string): boolean {
	const startIndex = sentence.indexOf(answer);

	if (startIndex < 0 || sentence.lastIndexOf(answer) !== startIndex) {
		return false;
	}

	if (isHangul(sentence.at(startIndex - 1) ?? '')) {
		return false;
	}

	let trailingIndex = startIndex + answer.length;

	while (isHangul(sentence.at(trailingIndex) ?? '')) {
		trailingIndex += 1;
	}

	return isParticleSequence(sentence.slice(startIndex + answer.length, trailingIndex));
}

function hasExactlyOneOccurrence(sentence: string, answer: string): boolean {
	const firstIndex = sentence.indexOf(answer);
	return firstIndex >= 0 && sentence.lastIndexOf(answer) === firstIndex;
}

function hasValidAlphabeticBoundary(sentence: string, answer: string): boolean {
	const startIndex = sentence.indexOf(answer);
	const before = sentence.at(startIndex - 1) ?? '';
	const after = sentence.at(startIndex + answer.length) ?? '';
	return !/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after);
}

function hasRequiredFields(example: GeneratedExample): boolean {
	if (typeof example !== 'object' || example == null) {
		return false;
	}

	return [
		example.sourceSentence,
		example.sourceAnswer,
		example.targetSentence,
		example.targetAnswer
	].every((value) => typeof value === 'string' && value.trim() !== '');
}

function hasValidSourceForm(example: GeneratedExample, voca: VocaInput): boolean {
	return (
		hasValidKoreanBoundary(example.sourceSentence, example.sourceAnswer) &&
		(voca.partOfSpeech === 'verb' ||
			voca.partOfSpeech === 'adjective' ||
			example.sourceAnswer === voca.sourceText)
	);
}

function hasValidTargetForm(example: GeneratedExample, voca: VocaInput): boolean {
	return (
		voca.targetLang !== 'en' ||
		isEnglishLexemeSurface(voca.targetText, example.targetAnswer, voca.partOfSpeech)
	);
}

function normalizeMechanicalFields(example: GeneratedExample, voca: VocaInput): GeneratedExample {
	if (typeof example !== 'object' || example == null) return example;
	const normalized = { ...example, targetPronunciation: '' };
	if (
		voca.partOfSpeech === 'noun' &&
		typeof example?.sourceSentence === 'string' &&
		hasExactlyOneOccurrence(example.sourceSentence, voca.sourceText) &&
		hasValidKoreanBoundary(example.sourceSentence, voca.sourceText)
	) {
		return { ...normalized, sourceAnswer: voca.sourceText };
	}

	return normalized;
}

function validateExample(example: GeneratedExample, voca: VocaInput): ValidationFailure | null {
	if (!hasRequiredFields(example)) {
		return 'EMPTY_FIELD';
	}
	if (!hasExactlyOneOccurrence(example.sourceSentence, example.sourceAnswer)) {
		return 'SOURCE_NOT_FOUND_ONCE';
	}
	if (!hasValidSourceForm(example, voca)) {
		return 'INVALID_SOURCE_FORM';
	}
	if (!hasExactlyOneOccurrence(example.targetSentence, example.targetAnswer)) {
		return 'TARGET_NOT_FOUND_ONCE';
	}
	if (
		(voca.targetLang === 'en' &&
			!hasValidAlphabeticBoundary(example.targetSentence, example.targetAnswer)) ||
		!hasValidTargetForm(example, voca)
	) {
		return 'INVALID_TARGET_FORM';
	}

	return null;
}

function validateAndFilterResponse(
	payload: GeneratedResponse,
	vocas: VocaInput[]
): ValidatedGeneration {
	const expectedCount = vocas.length;
	if (!Array.isArray(payload.items) || payload.items.length !== expectedCount) {
		throw new Error('AI response does not contain every requested item.');
	}

	const indices = new Set<number>();
	const filteredItems: GeneratedItem[] = new Array(expectedCount);
	const rejectionCounts = Object.fromEntries(
		VALIDATION_FAILURES.map((failure) => [failure, 0])
	) as ValidationFailureCounts;
	let generatedExampleCount = 0;

	for (const item of payload.items) {
		if (
			!Number.isInteger(item.index) ||
			item.index < 0 ||
			item.index >= expectedCount ||
			!Array.isArray(item.examples) ||
			item.examples.length > EXAMPLES_PER_VOCA
		) {
			throw new Error(`Invalid generated item: ${JSON.stringify(item)}.`);
		}

		if (indices.has(item.index)) {
			throw new Error(`Duplicate generated item index: ${item.index}.`);
		}

		indices.add(item.index);
		generatedExampleCount += item.examples.length;
		filteredItems[item.index] = {
			...item,
			examples: item.examples.flatMap((rawExample) => {
				const example = normalizeMechanicalFields(rawExample, vocas[item.index]);
				const failure = validateExample(example, vocas[item.index]);
				if (failure != null) {
					rejectionCounts[failure] += 1;
					return [];
				}
				return [example];
			})
		};
	}

	if (indices.size !== expectedCount) {
		throw new Error('AI response contains duplicate or missing indices.');
	}

	if (filteredItems.every((item) => item.examples.length === 0)) {
		throw new Error('Every generated example failed validation.');
	}

	return {
		payload: { items: filteredItems },
		generatedExampleCount,
		rejectionCounts
	};
}

function collectReviewRejectedExamples(
	beforeReview: GeneratedResponse,
	afterReview: GeneratedResponse
) {
	return beforeReview.items.flatMap((item) => {
		const accepted = new Set(afterReview.items[item.index]?.examples ?? []);
		return item.examples
			.filter((example) => !accepted.has(example))
			.map((example) => ({ index: item.index, example }));
	});
}

function addUsage(target: UsageSummary, usage: unknown): void {
	const value = usage as
		| {
				promptTokens?: number;
				completionTokens?: number;
				totalTokens?: number;
				cost?: number;
		  }
		| undefined;
	target.promptTokens += value?.promptTokens ?? 0;
	target.completionTokens += value?.completionTokens ?? 0;
	target.totalTokens += value?.totalTokens ?? 0;
	target.cost += value?.cost ?? 0;
}

async function requestValidatedJson<TResponse, TResult>({
	client,
	model,
	developerPrompt,
	input,
	usage,
	maxCompletionTokens,
	label,
	validate
}: {
	client: OpenRouter;
	model: string;
	developerPrompt: string;
	input: unknown;
	usage: UsageSummary;
	maxCompletionTokens: number;
	label: string;
	validate: (payload: TResponse) => TResult;
}): Promise<{ payload: TResult; attempts: number; responseModel: string }> {
	let previousContent = '';
	let validationError = '';

	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const userContent =
			attempt === 1
				? JSON.stringify(input)
				: JSON.stringify({
						inputs: input,
						validationError,
						previousResponse: previousContent,
						instruction: `Return a complete corrected ${label} response.`
					});
		const response = await client.chat.send({
			chatRequest: {
				stream: false,
				model,
				maxCompletionTokens,
				responseFormat: { type: 'json_object' },
				messages: [
					{ role: 'developer', content: developerPrompt },
					{ role: 'user', content: userContent }
				]
			}
		});

		if (!('choices' in response)) {
			throw new Error(`OpenRouter returned an unexpected streaming ${label} response.`);
		}

		addUsage(usage, response.usage);
		previousContent = readJsonContent(response.choices[0]?.message.content);

		try {
			return {
				payload: validate(JSON.parse(previousContent) as TResponse),
				attempts: attempt,
				responseModel: response.model
			};
		} catch (error) {
			validationError = error instanceof Error ? error.message : String(error);
			console.warn(`${label} validation failed (${attempt}/3): ${validationError}`);
		}
	}

	throw new Error(`${label} failed after 3 attempts: ${validationError}`);
}

async function generateAndReview({
	client,
	model,
	vocas,
	input,
	generationUsage,
	reviewUsage,
	generationPromptSuffix = ''
}: {
	client: OpenRouter;
	model: string;
	vocas: VocaInput[];
	input: GenerationInput[];
	generationUsage: UsageSummary;
	reviewUsage: UsageSummary;
	generationPromptSuffix?: string;
}) {
	const generation = await requestValidatedJson<GeneratedResponse, ValidatedGeneration>({
		client,
		model,
		developerPrompt: `${buildDeveloperPrompt()} ${generationPromptSuffix}`.trim(),
		input,
		usage: generationUsage,
		maxCompletionTokens: 16_384,
		label: 'Example generation',
		validate: (candidate) => validateAndFilterResponse(candidate, vocas)
	});
	const codeValidatedPayload = generation.payload.payload;
	const codeValidatedExampleCount = codeValidatedPayload.items.reduce(
		(count, item) => count + item.examples.length,
		0
	);
	const examplesForReview = codeValidatedPayload.items.flatMap((item) =>
		item.examples.map((example, exampleIndex) => ({ itemIndex: item.index, exampleIndex, example }))
	);
	const acceptedByItem = new Map<number, Set<number>>();
	const deferredExamples: Array<{
		itemIndex: number;
		example: GeneratedExample;
		attempts: ExampleReviewResult['attempts'];
		reason?: string;
	}> = [];
	let reviewAttempts = 0;
	for (let index = 0; index < examplesForReview.length; index += 5) {
		const chunk = examplesForReview.slice(index, index + 5);
		const results = await reviewExamplesWithLuna(
			chunk.map(({ itemIndex, example }) => ({
				...input[itemIndex],
				targetLang: vocas[itemIndex].targetLang,
				sourceSentence: example.sourceSentence,
				sourceAnswer: example.sourceAnswer,
				targetSentence: example.targetSentence,
				targetAnswer: example.targetAnswer,
				targetPronunciation: example.targetPronunciation
			}))
		);
		if (results.some((result) => result.attempts.length)) reviewAttempts++;
		const decisions = chunk.map((entry, i) => ({ ...entry, result: results[i] }));
		for (const { itemIndex, exampleIndex, example, result } of decisions) {
			if (result.targetPronunciation) example.targetPronunciation = result.targetPronunciation;
			if (result.targetPronunciationArpabet)
				example.targetPronunciationArpabet = result.targetPronunciationArpabet;
			for (const attempt of result.attempts) {
				reviewUsage.promptTokens += attempt.usage?.input_tokens ?? 0;
				reviewUsage.completionTokens += attempt.usage?.output_tokens ?? 0;
				reviewUsage.totalTokens +=
					(attempt.usage?.input_tokens ?? 0) + (attempt.usage?.output_tokens ?? 0);
				reviewUsage.cost += attempt.usage?.cost ?? 0;
			}
			if (result.status === 'deferred')
				deferredExamples.push({
					itemIndex,
					example,
					attempts: result.attempts,
					reason: 'reason' in result ? result.reason : undefined
				});
			if (result.accepted) {
				const indices = acceptedByItem.get(itemIndex) ?? new Set<number>();
				indices.add(exampleIndex);
				acceptedByItem.set(itemIndex, indices);
			}
		}
	}
	const reviewedPayload: GeneratedResponse = {
		items: codeValidatedPayload.items.map((item) => ({
			...item,
			examples: item.examples.filter((_, index) => acceptedByItem.get(item.index)?.has(index))
		}))
	};
	const reviewRejectedExamples = collectReviewRejectedExamples(
		codeValidatedPayload,
		reviewedPayload
	);

	return {
		payload: reviewedPayload,
		generatedExampleCount: generation.payload.generatedExampleCount,
		codeValidatedExampleCount,
		codeRejectionCounts: generation.payload.rejectionCounts,
		reviewRejectedExampleCount:
			codeValidatedExampleCount -
			reviewedPayload.items.reduce((count, item) => count + item.examples.length, 0) -
			deferredExamples.length,
		reviewRejectedExamples,
		deferredExamples,
		generationAttempts: generation.attempts,
		reviewAttempts,
		responseModel: generation.responseModel
	};
}

type BatchResult = Awaited<ReturnType<typeof generateAndReview>> & {
	payload: GeneratedResponse;
	generationUsage: UsageSummary;
	reviewUsage: UsageSummary;
	retryVocaCount: number;
	generatedExampleCount: number;
	codeValidatedExampleCount: number;
	reviewRejectedExampleCount: number;
	codeRejectionCounts: ValidationFailureCounts;
};

function createUsage(): UsageSummary {
	return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
}

function addUsageSummary(target: UsageSummary, source: UsageSummary): void {
	target.promptTokens += source.promptTokens;
	target.completionTokens += source.completionTokens;
	target.totalTokens += source.totalTokens;
	target.cost += source.cost;
}

function buildInput(vocas: VocaInput[]): GenerationInput[] {
	return vocas.map((voca, index) => ({
		index,
		sourceText: decodeHtmlEntities(voca.sourceText),
		sourceDefinition: decodeHtmlEntities(voca.sourceDefinition),
		partOfSpeech: voca.partOfSpeech,
		targetLang: voca.targetLang,
		targetText: decodeHtmlEntities(voca.targetText),
		targetDefinition: decodeHtmlEntities(voca.targetDefinition)
	}));
}

async function processBatch(
	client: OpenRouter,
	model: string,
	vocas: VocaInput[],
	input: GenerationInput[]
): Promise<BatchResult> {
	const generationUsage = createUsage();
	const reviewUsage = createUsage();
	const initialRun = await generateAndReview({
		client,
		model,
		vocas,
		input,
		generationUsage,
		reviewUsage
	});
	const payload = initialRun.payload;
	let generatedExampleCount = initialRun.generatedExampleCount;
	let codeValidatedExampleCount = initialRun.codeValidatedExampleCount;
	let reviewRejectedExampleCount = initialRun.reviewRejectedExampleCount;
	let generationAttempts = initialRun.generationAttempts;
	let reviewAttempts = initialRun.reviewAttempts;
	const codeRejectionCounts = initialRun.codeRejectionCounts;
	const deferredExamples = [...initialRun.deferredExamples];
	const deferredIndices = new Set(deferredExamples.map((item) => item.itemIndex));
	const failedIndices = payload.items
		.filter((item) => item.examples.length === 0 && !deferredIndices.has(item.index))
		.map((item) => item.index);

	if (failedIndices.length > 0) {
		try {
			const retryVocas = failedIndices.map((index) => vocas[index]);
			const retryInput = failedIndices.map((originalIndex, index) => ({
				...input[originalIndex],
				index
			}));
			const retryRun = await generateAndReview({
				client,
				model,
				vocas: retryVocas,
				input: retryInput,
				generationUsage,
				reviewUsage,
				generationPromptSuffix:
					'This is a retry for items with no surviving examples. Follow the supplied part of speech and answer marking exactly.'
			});
			deferredExamples.push(
				...retryRun.deferredExamples.map((item) => ({
					...item,
					itemIndex: failedIndices[item.itemIndex]
				}))
			);

			for (const retryItem of retryRun.payload.items) {
				payload.items[failedIndices[retryItem.index]] = {
					index: failedIndices[retryItem.index],
					examples: retryItem.examples
				};
			}
			generatedExampleCount += retryRun.generatedExampleCount;
			codeValidatedExampleCount += retryRun.codeValidatedExampleCount;
			reviewRejectedExampleCount += retryRun.reviewRejectedExampleCount;
			generationAttempts += retryRun.generationAttempts;
			reviewAttempts += retryRun.reviewAttempts;
			for (const failure of VALIDATION_FAILURES) {
				codeRejectionCounts[failure] += retryRun.codeRejectionCounts[failure];
			}
		} catch (error) {
			console.warn(`Failed-item retry skipped: ${error instanceof Error ? error.message : error}`);
		}
	}

	return {
		...initialRun,
		deferredExamples,
		payload,
		generationUsage,
		reviewUsage,
		retryVocaCount: failedIndices.length,
		generatedExampleCount,
		codeValidatedExampleCount,
		reviewRejectedExampleCount,
		codeRejectionCounts,
		generationAttempts,
		reviewAttempts
	};
}

async function main(): Promise<void> {
	const { mode, limit } = readExampleOptions(process.argv.slice(2));
	const batchSize = BATCH_SIZE;
	const model = resolveGenerationModel(process.env.OPENROUTER_MODEL);
	const startedAt = new Date();

	await mongoose.connect(requireEnvironment('MONGO_URI'));
	try {
		const collection = mongoose.connection.collection<VocaInput>('vocas');
		const client = new OpenRouter({ apiKey: requireEnvironment('OPENROUTER_API_KEY') });
		const failedVocaIds = new Set<string>();
		const totalGenerationUsage = createUsage();
		const totalReviewUsage = createUsage();
		let batchNumber = 0;
		let attemptedVocaCount = 0;
		let savedVocaCount = 0;
		let savedExampleCount = 0;
		let retryVocaCount = 0;
		let codeRejectedExampleCount = 0;
		let reviewRejectedExampleCount = 0;
		let cursor: { utilityScore: number; id: mongoose.Types.ObjectId } | undefined;
		const header = JSON.stringify({ startedAt, model, mode, limit, batchSize });
		const logPath = await createLogFile(
			'example-generation',
			`examples-${mode}`,
			startedAt,
			`${header}\n`
		);

		while (limit == null || attemptedVocaCount < limit) {
			const batchLimit = nextBatchSize(limit, attemptedVocaCount, batchSize);
			const vocas = await collection
				.aggregate<VocaInput>(examplePipeline(mode, batchLimit, cursor), { allowDiskUse: true })
				.toArray();
			if (vocas.length === 0) break;
			const lastVoca = vocas.at(-1)!;
			cursor = { utilityScore: lastVoca.utilityScore, id: lastVoca._id };

			batchNumber += 1;
			const input = buildInput(vocas);
			try {
				const result = await processBatch(client, model, vocas, input);
				if (result.deferredExamples.length) {
					for (const item of result.deferredExamples) {
						const voca = vocas[item.itemIndex];
						const { sourceText, sourceDefinition, partOfSpeech, targetText, targetDefinition } =
							input[item.itemIndex];
						await queueDeferredExample(
							{
								sourceText,
								sourceDefinition,
								partOfSpeech,
								targetText,
								targetDefinition,
								targetLang: voca.targetLang,
								...item.example
							},
							voca._id.toString(),
							item.attempts,
							item.reason
						);
					}
					const entries = result.deferredExamples.map(({ itemIndex, ...item }) =>
						JSON.stringify({ vocaId: vocas[itemIndex]._id.toString(), ...item })
					);
					await appendFile(`${logPath}.deferred.jsonl`, entries.join('\n') + '\n', 'utf8');
				}
				const successfulItems = result.payload.items.filter((item) => item.examples.length > 0);
				for (const item of result.payload.items) {
					if (item.examples.length === 0) {
						const vocaId = vocas[item.index]._id.toString();
						failedVocaIds.add(vocaId);
					}
				}
				const written = await saveGeneratedExamples(vocas, result.payload);
				attemptedVocaCount += vocas.length;
				savedVocaCount += written.vocas;
				savedExampleCount += written.examples;
				retryVocaCount += result.retryVocaCount;
				codeRejectedExampleCount += result.generatedExampleCount - result.codeValidatedExampleCount;
				reviewRejectedExampleCount += result.reviewRejectedExampleCount;
				addUsageSummary(totalGenerationUsage, result.generationUsage);
				addUsageSummary(totalReviewUsage, result.reviewUsage);

				const batchStats = {
					batch: batchNumber,
					vocas: vocas.length,
					savedVocas: written.vocas,
					failedVocas: vocas.length - successfulItems.length,
					examples: written.examples,
					retriedVocas: result.retryVocaCount,
					cost: result.generationUsage.cost + result.reviewUsage.cost
				};
				console.log(`[batch ${batchNumber}] ${JSON.stringify(batchStats)}`);
				await appendFile(logPath, `${JSON.stringify(batchStats)}\n`, 'utf8');
			} catch (error) {
				for (const voca of vocas) {
					const vocaId = voca._id.toString();
					failedVocaIds.add(vocaId);
				}
				attemptedVocaCount += vocas.length;
				const failure = `[batch ${batchNumber}] failed: ${error instanceof Error ? error.stack : error}`;
				console.error(failure);
				await appendFile(logPath, `${failure}\n`, 'utf8');
			}
		}

		const finalStats = {
			startedAt,
			finishedAt: new Date(),
			model,
			mode,
			limit,
			batchCount: batchNumber,
			attemptedVocaCount,
			savedVocaCount,
			failedVocaCount: failedVocaIds.size,
			savedExampleCount,
			retryVocaCount,
			codeRejectedExampleCount,
			reviewRejectedExampleCount,
			generationUsage: totalGenerationUsage,
			reviewUsage: totalReviewUsage,
			totalCost: totalGenerationUsage.cost + totalReviewUsage.cost,
			logPath
		};
		console.log(`[final] ${JSON.stringify(finalStats, null, 2)}`);
		await appendFile(logPath, `[final] ${JSON.stringify(finalStats, null, 2)}\n`, 'utf8');
	} finally {
		await mongoose.disconnect();
	}
}

await main();
