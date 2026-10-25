import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

import { OpenRouter } from '@openrouter/sdk';
import mongoose from 'mongoose';

import { createLogFile } from './log-file.ts';
import { getOpenRouterModel } from '../src/lib/server/openrouter-config.ts';
import {
	MAX_UTILITY_SCORE,
	MIN_RECOMMENDED_UTILITY_SCORE
} from '../src/lib/shared/types/general.type.ts';
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
};

type GenerationInput = Omit<VocaInput, '_id' | 'originKey' | 'targetLang'> & { index: number };

type GeneratedExample = {
	sourceSentence: string;
	sourceAnswer: string;
	targetSentence: string;
	targetAnswer: string;
	targetPronunciation: string;
};

type GeneratedItem = {
	index: number;
	examples: GeneratedExample[];
};

type GeneratedResponse = {
	items: GeneratedItem[];
};

type ReviewItem = {
	index: number;
	accepted: number[];
};

type ReviewResponse = {
	items: ReviewItem[];
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
	'INVALID_TARGET_FORM',
	'INVALID_PRONUNCIATION'
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

function readUtilityScore(args: string[]): number {
	if (args.length !== 1) {
		throw new Error('Usage: npm run examples:generate -- <utility-score>');
	}

	const utilityScore = Number(args[0]);
	if (
		!Number.isInteger(utilityScore) ||
		utilityScore < MIN_RECOMMENDED_UTILITY_SCORE ||
		utilityScore > MAX_UTILITY_SCORE
	) {
		throw new Error(
			`utility-score must be an integer from ${MIN_RECOMMENDED_UTILITY_SCORE} to ${MAX_UTILITY_SCORE}.`
		);
	}

	return utilityScore;
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
		`Generate ${EXAMPLES_PER_VOCA} natural Korean-English quiz examples for each vocabulary item; return fewer only when another valid example cannot be produced.`,
		'Each pair must use the supplied lexemes in the supplied senses, express the same situation in both languages, and be idiomatic and grammatically correct.',
		'Use only grammar-required inflections and do not replace either lexeme.',
		'Return sourceAnswer and targetAnswer as the exact sentence substrings to hide, and targetPronunciation as the Hangul reading of targetAnswer.',
		'Use Korean noun items as nouns, never as 하다 predicates; sourceAnswer is the unchanged headword with any particle left outside. For predicates, use the complete conjugated form.',
		'Keep every index unchanged and return it exactly once.',
		'Return an object shaped as {"items":[{"index":0,"examples":[{"sourceSentence":"...","sourceAnswer":"...","targetSentence":"...","targetAnswer":"...","targetPronunciation":"..."}]}]}.'
	].join(' ');
}

function buildReviewDeveloperPrompt(): string {
	return [
		'Return JSON only.',
		'Review each quiz example independently as a strict bilingual editor.',
		'Accept it only when both sentences are idiomatic contemporary usage, grammatically correct, express the same context, and use the supplied lexemes in the supplied senses.',
		'Do not reject a genuinely idiomatic example merely because another translation is more common; however, reject wording that is merely understandable or technically possible when a native speaker would normally avoid that lexeme or collocation in the given context.',
		'Return every item index exactly once and list only the zero-based example indices that pass.',
		'Return an object shaped as {"items":[{"index":0,"accepted":[0,2]}]}. Do not return explanations or corrected sentences.'
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
		example.targetAnswer,
		example.targetPronunciation
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
	return isEnglishLexemeSurface(voca.targetText, example.targetAnswer, voca.partOfSpeech);
}

function hasValidPronunciation(example: GeneratedExample): boolean {
	return (
		/\p{Script=Hangul}/u.test(example.targetPronunciation) &&
		/^[\p{Script=Hangul}\s.,!?()\-~0-9]+$/u.test(example.targetPronunciation)
	);
}

function normalizeMechanicalFields(example: GeneratedExample, voca: VocaInput): GeneratedExample {
	if (
		voca.partOfSpeech === 'noun' &&
		typeof example?.sourceSentence === 'string' &&
		hasExactlyOneOccurrence(example.sourceSentence, voca.sourceText) &&
		hasValidKoreanBoundary(example.sourceSentence, voca.sourceText)
	) {
		return { ...example, sourceAnswer: voca.sourceText };
	}

	return example;
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
		!hasValidAlphabeticBoundary(example.targetSentence, example.targetAnswer) ||
		!hasValidTargetForm(example, voca)
	) {
		return 'INVALID_TARGET_FORM';
	}
	if (!hasValidPronunciation(example)) {
		return 'INVALID_PRONUNCIATION';
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

function buildReviewInput(payload: GeneratedResponse, input: GenerationInput[]) {
	return payload.items
		.filter((item) => item.examples.length > 0)
		.map((item) => ({
			...input[item.index],
			examples: item.examples
		}));
}

function applyReview(payload: GeneratedResponse, review: ReviewResponse): GeneratedResponse {
	const reviewableItems = payload.items.filter((item) => item.examples.length > 0);

	if (!Array.isArray(review.items) || review.items.length !== reviewableItems.length) {
		throw new Error('AI review does not contain every reviewable item.');
	}

	const reviewsByIndex = new Map<number, Set<number>>();

	for (const item of review.items) {
		const generatedItem = payload.items[item.index];
		if (
			!Number.isInteger(item.index) ||
			generatedItem == null ||
			generatedItem.examples.length === 0 ||
			!Array.isArray(item.accepted) ||
			item.accepted.some(
				(exampleIndex) =>
					!Number.isInteger(exampleIndex) ||
					exampleIndex < 0 ||
					exampleIndex >= generatedItem.examples.length
			) ||
			new Set(item.accepted).size !== item.accepted.length ||
			reviewsByIndex.has(item.index)
		) {
			throw new Error(`Invalid review item: ${JSON.stringify(item)}.`);
		}

		reviewsByIndex.set(item.index, new Set(item.accepted));
	}

	if (reviewsByIndex.size !== reviewableItems.length) {
		throw new Error('AI review contains duplicate or missing indices.');
	}

	return {
		items: payload.items.map((item) => {
			const accepted = reviewsByIndex.get(item.index);
			return accepted == null
				? item
				: { ...item, examples: item.examples.filter((_, index) => accepted.has(index)) };
		})
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
	const reviewInput = buildReviewInput(codeValidatedPayload, input);
	const review = await requestValidatedJson<ReviewResponse, GeneratedResponse>({
		client,
		model,
		developerPrompt: buildReviewDeveloperPrompt(),
		input: reviewInput,
		usage: reviewUsage,
		maxCompletionTokens: 4096,
		label: 'Example review',
		validate: (candidate) => applyReview(codeValidatedPayload, candidate)
	});
	const reviewRejectedExamples = collectReviewRejectedExamples(
		codeValidatedPayload,
		review.payload
	);

	return {
		payload: review.payload,
		generatedExampleCount: generation.payload.generatedExampleCount,
		codeValidatedExampleCount,
		codeRejectionCounts: generation.payload.rejectionCounts,
		reviewRejectedExampleCount:
			codeValidatedExampleCount -
			review.payload.items.reduce((count, item) => count + item.examples.length, 0),
		reviewRejectedExamples,
		generationAttempts: generation.attempts,
		reviewAttempts: review.attempts,
		responseModel: generation.responseModel
	};
}

function buildEligiblePipeline(
	utilityScore: number,
	limit?: number,
	afterOriginKey?: string
): mongoose.PipelineStage[] {
	return [
		{
			$match: {
				targetLang: 'en',
				createdByUserId: { $exists: false },
				utilityScore,
				...(afterOriginKey == null ? {} : { originKey: { $gt: afterOriginKey } })
			}
		},
		{
			$lookup: {
				from: 'quizcards',
				let: { vocaId: { $toString: '$_id' } },
				pipeline: [
					{
						$match: {
							'examples.0': { $exists: true },
							$expr: { $eq: ['$vocaId', '$$vocaId'] }
						}
					},
					{ $limit: 1 }
				],
				as: 'quizCardsWithExamples'
			}
		},
		{ $match: { quizCardsWithExamples: { $eq: [] } } },
		{ $sort: { originKey: 1 } },
		...(limit == null ? [] : [{ $limit: limit }]),
		{
			$project: {
				originKey: 1,
				sourceText: 1,
				sourceDefinition: 1,
				partOfSpeech: 1,
				targetLang: 1,
				targetText: 1,
				targetDefinition: 1
			}
		}
	];
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
	const failedIndices = payload.items
		.filter((item) => item.examples.length === 0)
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

function hideAnswer(sentence: string, answer: string): string {
	return sentence.replace(answer, '{{---}}');
}

async function saveBatch(vocas: VocaInput[], payload: GeneratedResponse): Promise<number> {
	const now = new Date();
	const operations = payload.items
		.filter((item) => item.examples.length > 0)
		.map((item) => ({
			updateOne: {
				filter: { vocaId: vocas[item.index]._id.toString() },
				update: {
					$set: {
						examples: item.examples.map((example) => ({
							_id: randomUUID(),
							sourceSentenceTemplate: hideAnswer(example.sourceSentence, example.sourceAnswer),
							sourceFillText: example.sourceAnswer,
							targetSentenceTemplate: hideAnswer(example.targetSentence, example.targetAnswer),
							targetFillText: example.targetAnswer,
							targetPronunciationText: example.targetPronunciation,
							reportCount: 0,
							addedAt: now
						})),
						updatedAt: now
					},
					$setOnInsert: { _id: randomUUID(), createdAt: now }
				},
				upsert: true
			}
		}));

	if (operations.length > 0) {
		await mongoose.connection.collection('quizcards').bulkWrite(operations, { ordered: false });
	}
	return operations.length;
}

async function main(): Promise<void> {
	const utilityScore = readUtilityScore(process.argv.slice(2));
	const batchSize = BATCH_SIZE;
	const model = getOpenRouterModel();
	const startedAt = new Date();

	await mongoose.connect(requireEnvironment('MONGO_URI'));
	try {
		const collection = mongoose.connection.collection<VocaInput>('vocas');
		const countRows = await collection
			.aggregate<{ count: number }>([...buildEligiblePipeline(utilityScore), { $count: 'count' }])
			.toArray();
		const eligibleCount = countRows[0]?.count ?? 0;
		if (eligibleCount === 0) {
			console.log(`No eligible utilityScore ${utilityScore} vocas without examples were found.`);
			return;
		}

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
		let afterOriginKey: string | undefined;
		const header = JSON.stringify({ startedAt, model, utilityScore, eligibleCount, batchSize });
		const logPath = await createLogFile(
			'example-generation',
			`utility-${utilityScore}`,
			startedAt,
			`${header}\n`
		);

		while (true) {
			const vocas = await collection
				.aggregate<VocaInput>(buildEligiblePipeline(utilityScore, batchSize, afterOriginKey))
				.toArray();
			if (vocas.length === 0) break;
			afterOriginKey = vocas.at(-1)?.originKey;

			batchNumber += 1;
			const input = buildInput(vocas);
			try {
				const result = await processBatch(client, model, vocas, input);
				const successfulItems = result.payload.items.filter((item) => item.examples.length > 0);
				for (const item of result.payload.items) {
					if (item.examples.length === 0) {
						const vocaId = vocas[item.index]._id.toString();
						failedVocaIds.add(vocaId);
					}
				}
				const writtenCount = await saveBatch(vocas, result.payload);
				attemptedVocaCount += vocas.length;
				savedVocaCount += writtenCount;
				savedExampleCount += successfulItems.reduce(
					(count, item) => count + item.examples.length,
					0
				);
				retryVocaCount += result.retryVocaCount;
				codeRejectedExampleCount += result.generatedExampleCount - result.codeValidatedExampleCount;
				reviewRejectedExampleCount += result.reviewRejectedExampleCount;
				addUsageSummary(totalGenerationUsage, result.generationUsage);
				addUsageSummary(totalReviewUsage, result.reviewUsage);

				const batchStats = {
					batch: batchNumber,
					vocas: vocas.length,
					savedVocas: successfulItems.length,
					failedVocas: vocas.length - successfulItems.length,
					examples: successfulItems.reduce((count, item) => count + item.examples.length, 0),
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
			utilityScore,
			eligibleVocaCount: eligibleCount,
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
