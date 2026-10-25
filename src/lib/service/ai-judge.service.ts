import { randomUUID } from 'node:crypto';

import type { AnswerJudgeResult } from '$lib/shared/types/answer-memo.type';
import type { QuizCardCreate, QuizExample } from '$lib/shared/types/quiz-card.type';
import type { QuizEncounter } from '$lib/shared/types/quiz.type';
import type { PartOfSpeech, Voca } from '$lib/shared/types/voca.type';

import { sendOpenRouterJson } from '$lib/server/openrouter';
import {
	AI_JUDGE_REASON_CODES,
	KOREAN_LANGUAGE_CODE,
	LANGUAGE_CODES,
	QUIZ_TEMPLATE_SLOT,
	type LanguageCode
} from '$lib/shared/types/general.type';
import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';
import { fillQuizTemplate } from '$lib/shared/utils/answer.util';
import { isEnglishLexemeSurface } from '$lib/shared/utils/lexeme.util';
import { sanitizeAiJudgeHintText } from '$lib/shared/utils/quiz-feedback.util';

type OpenRouterMessage = { role: 'developer' | 'user'; content: string };

export type GeneratedExampleText = {
	languageCode: LanguageCode;
	fullSentence: string;
	answerSurface: string;
	pronunciationText: string;
};

export type GeneratedQuizExample = {
	texts: GeneratedExampleText[];
};

export class NoValidQuizExamplesError extends Error {
	constructor() {
		super('예문 생성에 실패했어요.');
		this.name = 'NoValidQuizExamplesError';
	}
}

export type QuizCardSeed = {
	difficultyLevel: number;
	utilityScore: number;
	examples: GeneratedQuizExample[];
};

export type GenerateQuizCardSeedInput = {
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: PartOfSpeech;
	targetLang: LanguageCode;
	targetText: string;
	targetDefinition: string;
};

type GenerateCustomVocaInput = {
	sourceText: string;
	targetLang: LanguageCode;
	targetText: string;
	meaningHint: string;
};

export type CustomVocaValidationCandidate = Pick<
	Voca,
	'_id' | 'originKey' | 'targetText' | 'sourceDefinition' | 'targetDefinition'
>;

export type CustomVocaValidation = {
	isValid: boolean;
	rejectionMessage: string;
	matchingOriginKey: string;
	sourceDefinition: string;
	partOfSpeech: PartOfSpeech;
	targetDefinition: string;
};

const HANGUL_PRONUNCIATION_PATTERN_SOURCE = '^[가-힣ㄱ-ㅣ0-9\\s.,!?()\\-~]+$';
const HANGUL_PRONUNCIATION_PATTERN = new RegExp(HANGUL_PRONUNCIATION_PATTERN_SOURCE);
const HANGUL_CHAR_PATTERN = /[가-힣ㄱ-ㅣ]/;
const ASCII_LETTER_PATTERN = /[A-Za-z]/;
const GENERATED_EXAMPLE_CANDIDATE_COUNT = 3;
const KOREAN_PARTICLE_TOKENS = [
	'이라도',
	'에서',
	'에게',
	'한테',
	'으로',
	'부터',
	'까지',
	'처럼',
	'이나',
	'라도',
	'이랑',
	'보다',
	'은',
	'는',
	'을',
	'를',
	'의',
	'에',
	'께',
	'와',
	'과',
	'도',
	'만',
	'로',
	'이',
	'가',
	'나',
	'랑'
] as const;
const EXAMPLE_RULES_PROMPT =
	'Return fullSentence with no {{---}}. ' +
	'Return answerSurface as the exact substring to hide from fullSentence. ' +
	'answerSurface MUST occur exactly once and stay the same lexeme; grammar-driven inflections only. ' +
	'Every sentence MUST be grammatically correct and internally coherent; apply all required inflections, including plural count nouns after quantities ("three games", NEVER "three game"). ' +
	'Every sentence MUST also sound natural and idiomatic to a modern native speaker, not merely be grammatically possible. ' +
	'Use common collocations and a representative real-world use of the exact supplied sense. ' +
	'Never force an uncommon part of speech, awkward noun conversion, or unusual collocation just to include the target lexeme; choose a different context instead. ' +
	'Do not translate the Korean source independently: targetText is mandatory, and the target answer must be targetText itself or only a grammar-required inflection of that same lexeme. ' +
	'NEVER use compounds, derivatives, related words, explanations, or replacements: apple→apples is allowed; apple→apple tree is forbidden. ' +
	'Korean noun answerSurface MUST exclude trailing particles: "사과를"→"사과". ' +
	'Korean nouns MAY take any natural particle in fullSentence ("적격의 후보" is allowed for sourceText "적격"); keep that particle outside answerSurface. ' +
	'The bilingual sentences must match in meaning, but their grammatical structures do not need to mirror each other. ' +
	'For Korean predicates, answerSurface must include the full conjugated surface form: use "사과하고", NEVER "사과하". ' +
	'For sourcePartOfSpeech verb or adjective, Korean answerSurface may use a natural inflection; ' +
	'for every other known sourcePartOfSpeech, preserve sourceText exactly. ' +
	'If sourceText is unnatural in a context, rewrite the whole context instead of replacing the headword. ' +
	'Across the examples, prefer natural surface-form variety when the lexeme naturally supports it, ' +
	'but NEVER force awkward variation. ' +
	'pronunciationText is required for answerSurface only. ' +
	'For Korean answers, copy the Korean answerSurface. ' +
	'For non-Korean answers, pronunciationText MUST be a Hangul phonetic transcription ' +
	'(appropriate→어프로프리엇); NEVER copy the original script or use IPA.';

const GENERATE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['difficultyLevel', 'utilityScore', 'examples'],
	properties: {
		difficultyLevel: { type: 'integer', minimum: 1, maximum: 10 },
		utilityScore: { type: 'integer', minimum: 1, maximum: 5 },
		examples: {
			type: 'array',
			minItems: 0,
			maxItems: GENERATED_EXAMPLE_CANDIDATE_COUNT,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['texts'],
				properties: {
					texts: {
						type: 'array',
						minItems: 2,
						maxItems: 2,
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['languageCode', 'fullSentence', 'answerSurface', 'pronunciationText'],
							properties: {
								languageCode: { type: 'string' },
								fullSentence: { type: 'string' },
								answerSurface: { type: 'string' },
								pronunciationText: {
									type: 'string',
									pattern: HANGUL_PRONUNCIATION_PATTERN_SOURCE
								}
							}
						}
					}
				}
			}
		}
	}
} as const;

const CUSTOM_VOCA_VALIDATION_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: [
		'isValid',
		'rejectionMessage',
		'matchingOriginKey',
		'sourceDefinition',
		'partOfSpeech',
		'targetDefinition'
	],
	properties: {
		isValid: { type: 'boolean' },
		rejectionMessage: { type: 'string' },
		matchingOriginKey: { type: 'string' },
		sourceDefinition: { type: 'string' },
		partOfSpeech: { type: 'string', enum: Object.values(PARTS_OF_SPEECH) },
		targetDefinition: { type: 'string' }
	}
} as const;

const JUDGE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['reasonCode', 'hintText'],
	properties: {
		reasonCode: {
			type: 'string',
			enum: Object.values(AI_JUDGE_REASON_CODES)
		},
		hintText: { type: 'string' }
	}
} as const;

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function isHangulChar(value: string): boolean {
	return HANGUL_CHAR_PATTERN.test(value);
}

function isAsciiLetter(value: string): boolean {
	return ASCII_LETTER_PATTERN.test(value);
}

function validateTemplateSlot(template: string): string {
	const normalizedTemplate = template.trim();
	const slotIndex = normalizedTemplate.indexOf(QUIZ_TEMPLATE_SLOT);

	if (normalizedTemplate === '') {
		throw new Error('sentenceTemplate must not be empty.');
	}

	if (
		slotIndex < 0 ||
		normalizedTemplate.indexOf(QUIZ_TEMPLATE_SLOT, slotIndex + QUIZ_TEMPLATE_SLOT.length) >= 0
	) {
		throw new Error(`Template must include ${QUIZ_TEMPLATE_SLOT} exactly once.`);
	}

	return normalizedTemplate;
}

function validateFillText(fillText: string, fieldName: string): string {
	const normalizedFillText = fillText.trim();

	if (normalizedFillText === '') {
		throw new Error(`${fieldName} must not be empty.`);
	}

	if (normalizedFillText.includes(QUIZ_TEMPLATE_SLOT)) {
		throw new Error(`${fieldName} must not contain ${QUIZ_TEMPLATE_SLOT}.`);
	}

	return normalizedFillText;
}

function validateFullSentence(fullSentence: string): string {
	const normalizedFullSentence = fullSentence.trim();

	if (normalizedFullSentence === '') {
		throw new Error('fullSentence must not be empty.');
	}

	if (normalizedFullSentence.includes(QUIZ_TEMPLATE_SLOT)) {
		throw new Error(`fullSentence must not contain ${QUIZ_TEMPLATE_SLOT}.`);
	}

	return normalizedFullSentence;
}

function validatePronunciationText(pronunciationText: string): string {
	const normalizedPronunciationText = pronunciationText.trim();

	if (normalizedPronunciationText === '') {
		throw new Error('pronunciationText must not be empty.');
	}

	if (normalizedPronunciationText.includes(QUIZ_TEMPLATE_SLOT)) {
		throw new Error(`pronunciationText must not contain ${QUIZ_TEMPLATE_SLOT}.`);
	}

	if (!HANGUL_PRONUNCIATION_PATTERN.test(normalizedPronunciationText)) {
		throw new Error('pronunciationText must use Korean Hangul only.');
	}

	return normalizedPronunciationText;
}

function findUniqueSurfaceIndex(fullSentence: string, answerSurface: string): number {
	const firstIndex = fullSentence.indexOf(answerSurface);

	if (firstIndex < 0 || fullSentence.lastIndexOf(answerSurface) !== firstIndex) {
		throw new Error('answerSurface must appear in fullSentence exactly once.');
	}

	return firstIndex;
}

function extractHangulRun(value: string, startIndex: number): string {
	let endIndex = startIndex;

	while (isHangulChar(value.at(endIndex) ?? '')) {
		endIndex += 1;
	}

	return value.slice(startIndex, endIndex);
}

function isKoreanParticleSequence(value: string): boolean {
	if (value === '') {
		return true;
	}

	const memo = new Map<number, boolean>();

	function visit(index: number): boolean {
		if (index === value.length) {
			return true;
		}

		const cached = memo.get(index);

		if (cached != null) {
			return cached;
		}

		for (const token of KOREAN_PARTICLE_TOKENS) {
			if (value.startsWith(token, index) && visit(index + token.length)) {
				memo.set(index, true);
				return true;
			}
		}

		memo.set(index, false);
		return false;
	}

	return visit(0);
}

function validateKoreanAnswerSurfaceBoundary(
	fullSentence: string,
	answerSurface: string,
	startIndex: number
): void {
	if (isHangulChar(fullSentence.at(startIndex - 1) ?? '')) {
		throw new Error('Korean answerSurface must not be directly preceded by Hangul.');
	}

	const trailingIndex = startIndex + answerSurface.length;

	if (!isHangulChar(fullSentence.at(trailingIndex) ?? '')) {
		return;
	}

	if (!isKoreanParticleSequence(extractHangulRun(fullSentence, trailingIndex))) {
		throw new Error('Korean trailing Hangul after answerSurface must be a particle sequence only.');
	}
}

function validateAlphabeticAnswerSurfaceBoundary(
	fullSentence: string,
	answerSurface: string,
	startIndex: number
): void {
	const beforeChar = fullSentence.at(startIndex - 1) ?? '';
	const afterChar = fullSentence.at(startIndex + answerSurface.length) ?? '';

	if (isAsciiLetter(beforeChar) || isAsciiLetter(afterChar)) {
		throw new Error('answerSurface must not be inside a larger alphabetic word.');
	}
}

function normalizeDefinition(value: string, fieldName: string): string {
	const normalizedValue = normalizeWhitespace(value);

	if (normalizedValue === '') {
		throw new Error(`${fieldName} must not be empty.`);
	}

	return normalizedValue;
}

function buildTemplateFromGeneratedText(
	generatedText: GeneratedExampleText,
	languageCode: LanguageCode
): {
	sentenceTemplate: string;
	fillText: string;
} {
	const fullSentence = validateFullSentence(generatedText.fullSentence);
	const answerSurface = validateFillText(generatedText.answerSurface, 'answerSurface');
	const startIndex = findUniqueSurfaceIndex(fullSentence, answerSurface);

	if (languageCode === KOREAN_LANGUAGE_CODE) {
		validateKoreanAnswerSurfaceBoundary(fullSentence, answerSurface, startIndex);
	} else {
		validateAlphabeticAnswerSurfaceBoundary(fullSentence, answerSurface, startIndex);
	}

	return {
		sentenceTemplate: validateTemplateSlot(
			`${fullSentence.slice(0, startIndex)}${QUIZ_TEMPLATE_SLOT}${fullSentence.slice(
				startIndex + answerSurface.length
			)}`
		),
		fillText: answerSurface
	};
}

function normalizeExample(example: GeneratedQuizExample, targetLang: LanguageCode): QuizExample {
	const textsByLang = new Map<LanguageCode, GeneratedExampleText>();

	for (const generatedText of example.texts) {
		textsByLang.set(generatedText.languageCode, generatedText);
	}

	const sourceText = textsByLang.get(KOREAN_LANGUAGE_CODE);
	const targetText = textsByLang.get(targetLang);

	if (sourceText == null || targetText == null) {
		throw new Error('Each example must contain both Korean and target-language texts.');
	}

	const normalizedSourceText = buildTemplateFromGeneratedText(sourceText, KOREAN_LANGUAGE_CODE);
	const normalizedTargetText = buildTemplateFromGeneratedText(targetText, targetLang);

	return {
		_id: randomUUID(),
		sourceSentenceTemplate: normalizedSourceText.sentenceTemplate,
		sourceFillText: normalizedSourceText.fillText,
		targetSentenceTemplate: normalizedTargetText.sentenceTemplate,
		targetFillText: normalizedTargetText.fillText,
		targetPronunciationText: validatePronunciationText(targetText.pronunciationText),
		reportCount: 0,
		addedAt: new Date().toISOString()
	};
}

function validateSeed(seed: QuizCardSeed, allowInvalidUtilityScore: boolean): QuizCardSeed {
	if (
		!Number.isInteger(seed.difficultyLevel) ||
		seed.difficultyLevel < 1 ||
		seed.difficultyLevel > 10
	) {
		throw new Error('AI did not return a valid difficultyLevel.');
	}

	const minimumUtilityScore = allowInvalidUtilityScore ? 0 : 1;

	if (
		!Number.isInteger(seed.utilityScore) ||
		seed.utilityScore < minimumUtilityScore ||
		seed.utilityScore > 5
	) {
		throw new Error('AI did not return a valid utilityScore.');
	}

	if (seed.examples.length === 0 && !(allowInvalidUtilityScore && seed.utilityScore === 0)) {
		throw new Error('AI did not return quiz examples.');
	}

	return seed;
}

function validateSeedForQuizCard(
	seed: QuizCardSeed,
	input: GenerateQuizCardSeedInput
): QuizCardSeed {
	const validSeed = validateSeed(seed, true);
	const validExamples = validSeed.examples.filter((example) => {
		try {
			const normalizedExample = normalizeExample(example, input.targetLang);

			if (
				input.targetLang === LANGUAGE_CODES.EN &&
				!isEnglishLexemeSurface(
					input.targetText,
					normalizedExample.targetFillText,
					input.partOfSpeech
				)
			) {
				return false;
			}

			return true;
		} catch {
			return false;
		}
	});

	if (validExamples.length === 0) {
		if (validSeed.utilityScore === 0) {
			return { ...validSeed, utilityScore: 0, examples: [] };
		}

		throw new NoValidQuizExamplesError();
	}

	return { ...validSeed, examples: validExamples };
}

function buildGenerateSeedLines(input: GenerateQuizCardSeedInput): string {
	const lines = [
		`sourceText:${input.sourceText}`,
		`sourceDefinition:${input.sourceDefinition}`,
		`sourcePartOfSpeech:${input.partOfSpeech}`,
		`targetLang:${input.targetLang}`,
		`targetText:${input.targetText}`,
		`targetDefinition:${input.targetDefinition}`
	];

	return lines.join('\n');
}

function buildGenerateDeveloperPrompt(): string {
	return (
		'Return JSON only. ' +
		'If the exact vocabulary pair is correct but no natural, useful, grammatically sound example can be made for the supplied sense, set utilityScore to 0 and return an empty examples array. Never keep an awkward example merely to avoid utilityScore 0. ' +
		`Generate up to ${GENERATED_EXAMPLE_CANDIDATE_COUNT} bilingual quiz examples for one Korean source word and one target-language lexeme; prefer ${GENERATED_EXAMPLE_CANDIDATE_COUNT}, but keep only genuinely good examples. ` +
		'The Korean side and the target-language side must express the same context. ' +
		'Use the supplied sourceDefinition and targetDefinition fields to stay inside the intended sense. ' +
		EXAMPLE_RULES_PROMPT +
		'Accept any pair in which the supplied source and target lexemes are valid, natural translations in the given sense and context; do not reject it merely because another translation is more common or representative. ' +
		'Discard only pairs that are incorrect, semantically mismatched, unnatural, grammatically flawed, factually incoherent, or use an invalid lexeme transformation. ' +
		'Return fewer examples only when additional valid examples cannot be produced, and return an empty examples array only when no valid natural context exists. ' +
		'Create new study sentences in fresh, natural contexts. ' +
		'difficultyLevel scale: 1-2 beginner core, 3-4 easy general, 5-6 intermediate practical, 7-8 advanced or low-frequency, 9-10 very rare or specialized. ' +
		'utilityScore scale: 0 invalid or unsuitable for a natural quiz example, 1 rare, 2 limited, 3 useful, 4 practical, 5 core.'
	);
}

function buildRepairSeedLines(
	input: GenerateQuizCardSeedInput,
	previousSeed: QuizCardSeed,
	validationError: string
): string {
	return [
		buildGenerateSeedLines(input),
		`validationError:${validationError}`,
		`previousJson:${JSON.stringify(previousSeed)}`,
		'Return corrected JSON only.',
		'Fix the invalid fields without changing the intended lexeme pair.'
	].join('\n');
}

function buildGenerateCustomLines(input: GenerateCustomVocaInput): string {
	return [
		`sourceText:${input.sourceText}`,
		`targetLang:${input.targetLang}`,
		`targetText:${input.targetText}`,
		`meaningHint:${input.meaningHint}`
	].join('\n');
}

function buildValidateCustomLines(
	input: GenerateCustomVocaInput,
	candidates: CustomVocaValidationCandidate[]
): string {
	return [
		buildGenerateCustomLines(input),
		`existingCandidates:${JSON.stringify(
			candidates.map((candidate) => ({
				originKey: candidate.originKey,
				targetText: candidate.targetText,
				sourceDefinition: candidate.sourceDefinition,
				targetDefinition: candidate.targetDefinition
			}))
		)}`
	].join('\n');
}

function buildValidateCustomPrompt(): string {
	return (
		'Return JSON only. Validate a user-proposed Korean-to-target-language vocabulary pair conservatively. ' +
		'Set isValid=false when either expression does not exist, has a spelling or grammatical error, ' +
		'or the expressions do not correspond in the intended meaningHint. ' +
		'Reject an expression that can only be forced into unnatural examples. ' +
		'If uncertain, reject it with a short Korean rejectionMessage. ' +
		'Compare the intended sense with every existingCandidate. ' +
		'When an existing candidate represents the same Korean sense, copy its originKey exactly into matchingOriginKey even if targetText is a different synonym; otherwise return an empty string. ' +
		'For a valid non-duplicate pair, return an empty rejectionMessage and matchingOriginKey, ' +
		'a concise dictionary-style Korean sourceDefinition, the partOfSpeech of sourceText, ' +
		'and a concise targetDefinition. Never silently correct sourceText or targetText. '
	);
}

function validateCustomVocaValidation(
	validation: CustomVocaValidation,
	candidates: CustomVocaValidationCandidate[]
): CustomVocaValidation {
	if (!Object.values(PARTS_OF_SPEECH).includes(validation.partOfSpeech)) {
		throw new Error('partOfSpeech is invalid.');
	}

	if (
		validation.matchingOriginKey !== '' &&
		!candidates.some((candidate) => candidate.originKey === validation.matchingOriginKey)
	) {
		throw new Error('matchingOriginKey is invalid.');
	}

	if (!validation.isValid) {
		if (normalizeWhitespace(validation.rejectionMessage) === '') {
			throw new Error('rejectionMessage is required.');
		}
		return validation;
	}

	normalizeDefinition(validation.sourceDefinition, 'sourceDefinition');
	normalizeDefinition(validation.targetDefinition, 'targetDefinition');
	return validation;
}

function requestQuizCardSeed(messages: OpenRouterMessage[], allowInvalidUtilityScore = false) {
	const schema = allowInvalidUtilityScore
		? {
				...GENERATE_SCHEMA,
				properties: {
					...GENERATE_SCHEMA.properties,
					utilityScore: { type: 'integer', minimum: 0, maximum: 5 }
				}
			}
		: GENERATE_SCHEMA;

	return sendOpenRouterJson<QuizCardSeed>({
		schemaName: 'word_quest_pair_voca_examples',
		schema,
		messages
	});
}

function requestCustomVocaValidation(messages: OpenRouterMessage[]) {
	return sendOpenRouterJson<CustomVocaValidation>({
		schemaName: 'word_quest_custom_voca_validation',
		schema: CUSTOM_VOCA_VALIDATION_SCHEMA,
		messages
	});
}

async function requestValidatedJson<T>({
	buildRepairLines,
	developerPrompt,
	requestJson,
	userContent,
	validate
}: {
	buildRepairLines: (payload: T, validationError: string) => string;
	developerPrompt: string;
	requestJson: (messages: OpenRouterMessage[]) => Promise<T>;
	userContent: string;
	validate: (payload: T) => T;
}): Promise<T> {
	const initialMessages: OpenRouterMessage[] = [
		{ role: 'developer', content: developerPrompt },
		{ role: 'user', content: userContent }
	];
	let initialPayload: T;

	try {
		initialPayload = await requestJson(initialMessages);
	} catch {
		initialPayload = await requestJson(initialMessages);
	}

	try {
		return validate(initialPayload);
	} catch (error) {
		const validationError =
			error instanceof Error ? error.message : 'Generated payload validation failed.';
		const repairedPayload = await requestJson([
			{
				role: 'developer',
				content: `${developerPrompt} Correct any invalid field before returning JSON.`
			},
			{
				role: 'user',
				content: buildRepairLines(initialPayload, validationError)
			}
		]);

		return validate(repairedPayload);
	}
}

export async function generateQuizCardSeed(
	input: GenerateQuizCardSeedInput
): Promise<QuizCardSeed> {
	const developerPrompt = buildGenerateDeveloperPrompt();

	return requestValidatedJson({
		buildRepairLines: (previousSeed, validationError) =>
			buildRepairSeedLines(input, previousSeed, validationError),
		developerPrompt,
		requestJson: (messages) => requestQuizCardSeed(messages, true),
		userContent: buildGenerateSeedLines(input),
		validate: (seed) => validateSeedForQuizCard(seed, input)
	});
}

export async function validateCustomVocaInput(
	input: GenerateCustomVocaInput,
	candidates: CustomVocaValidationCandidate[]
): Promise<CustomVocaValidation> {
	const validation = await requestCustomVocaValidation([
		{ role: 'developer', content: buildValidateCustomPrompt() },
		{ role: 'user', content: buildValidateCustomLines(input, candidates) }
	]);

	return validateCustomVocaValidation(validation, candidates);
}

export function buildQuizCardCreate(
	vocaId: string,
	targetLang: LanguageCode,
	seed: {
		difficultyLevel?: number;
		utilityScore?: number;
		examples: GeneratedQuizExample[];
	}
): QuizCardCreate {
	return {
		vocaId,
		examples: seed.examples.map((example) => normalizeExample(example, targetLang))
	};
}

export function buildSeedInputFromVoca(currentVoca: Voca): GenerateQuizCardSeedInput {
	return {
		sourceText: currentVoca.sourceText,
		sourceDefinition: currentVoca.sourceDefinition,
		partOfSpeech: currentVoca.partOfSpeech,
		targetLang: currentVoca.targetLang,
		targetText: currentVoca.targetText,
		targetDefinition: currentVoca.targetDefinition
	};
}

export async function judgeAnswer(
	currentEncounter: Pick<
		QuizEncounter,
		'answerLang' | 'answerTemplate' | 'promptTemplate' | 'promptFillText'
	>,
	correctAnswerText: string,
	userAnswer: string,
	previousResult?: AnswerJudgeResult
): Promise<AnswerJudgeResult> {
	const judgedResult = await sendOpenRouterJson<AnswerJudgeResult>({
		schemaName: 'word_quest_judge',
		schema: JUDGE_SCHEMA,
		messages: [
			{
				role: 'developer',
				content:
					'Return JSON only. ' +
					'This system uses exact-match grading only. ' +
					'The userAnswer already failed exact match, so it must stay wrong. ' +
					'Return only the best explanation code. ' +
					'Use alternateAnswer when the answer is semantically close or usable in context, but still not the exact required answer. ' +
					'Otherwise use typo, tense, number, agreement, article, wordForm, unnatural, context, or meaning. ' +
					'hintText must be short Korean. ' +
					'hintText must not contain the exact correct answer. ' +
					(previousResult == null
						? ''
						: 'The previous AI explanation was rejected as incorrect. Re-evaluate independently and return a corrected explanation.')
			},
			{
				role: 'user',
				content:
					`answerLang:${currentEncounter.answerLang}\n` +
					`correct:${correctAnswerText}\n` +
					`answerSentence:${fillQuizTemplate(currentEncounter.answerTemplate, correctAnswerText)}\n` +
					`promptSentence:${fillQuizTemplate(currentEncounter.promptTemplate, currentEncounter.promptFillText)}\n` +
					`userAnswer:${userAnswer}` +
					(previousResult == null
						? ''
						: `\npreviousReasonCode:${previousResult.reasonCode}\npreviousHintText:${previousResult.hintText}`)
			}
		]
	});

	return {
		reasonCode: judgedResult.reasonCode,
		hintText: sanitizeAiJudgeHintText(
			judgedResult.reasonCode,
			judgedResult.hintText,
			currentEncounter.answerLang,
			correctAnswerText
		)
	};
}
