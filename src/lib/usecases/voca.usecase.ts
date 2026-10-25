import type { LanguageCode } from '$lib/shared/types/general.type';
import type { QuizCard, QuizExample } from '$lib/shared/types/quiz-card.type';
import type { PartOfSpeech, Voca } from '$lib/shared/types/voca.type';

import { createCustomVocaBundle } from '$lib/repositories/custom-voca.repository';
import {
	createQuizCard,
	findQuizCardByVocaId,
	saveQuizCard
} from '$lib/repositories/quiz-card.repository';
import { findPendingReportedVocaIds } from '$lib/repositories/quiz-report.repository';
import {
	createReview,
	findReviewByUserAndVoca,
	hasReviewByUserAndVoca,
	saveReview
} from '$lib/repositories/review.repository';
import {
	findPermanentlyExcludedVocaIds,
	findVocasBySourceText,
	getVocaById,
	normalizeSourceText,
	normalizeTargetText,
	saveVoca
} from '$lib/repositories/voca.repository';
import {
	signPendingReview,
	verifyPendingReviewSignature
} from '$lib/server/pending-review-signature';
import {
	buildQuizCardCreate,
	buildSeedInputFromVoca,
	generateQuizCardSeed,
	NoValidQuizExamplesError,
	validateCustomVocaInput
} from '$lib/service/ai-judge.service';
import { assertCanStartNewVoca, NewVocaLimitError } from '$lib/service/new-voca-limit.service';
import { applyGeneratedMetadata, buildCustomVocaCreate } from '$lib/service/voca.service';
import {
	INVALID_UTILITY_SCORE,
	KOREAN_LANGUAGE_CODE,
	LANGUAGE_CODES
} from '$lib/shared/types/general.type';
import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';
import {
	buildCustomOriginKey,
	getCustomSenseNumber,
	getNextCustomSenseNumber,
	isCustomOriginKey
} from '$lib/shared/utils/custom-voca.util';

type GeneratedExampleText = {
	languageCode: LanguageCode;
	fullSentence: string;
	answerSurface: string;
	pronunciationText: string;
};

const SOURCE_TEXT_MAX_LENGTH = 100;
const TARGET_TEXT_MAX_LENGTH = 150;
const MEANING_HINT_MAX_LENGTH = 500;
const SEARCH_LETTER_PATTERN = /[A-Za-z가-힣ㄱ-ㅣ]/;

type GeneratedQuizExample = {
	texts: GeneratedExampleText[];
};

type CandidateSeed = {
	difficultyLevel: number;
	utilityScore: number;
	examples: GeneratedQuizExample[];
};

type CreateVocaSuccess = {
	createdQuizCard: QuizCard;
	createdVoca: Voca;
};

type ReviewVocaPreview = {
	sourceText: string;
	sourceDefinition: string;
	targetText: string;
	targetDefinition: string;
	difficultyLevel: number | null;
	utilityScore: number | null;
};

type PendingExistingReviewPayload = {
	mode: 'existing';
	vocaId: string;
	targetLang: LanguageCode;
	seed: CandidateSeed;
};

type PendingStoredReviewPayload = {
	mode: 'stored';
	vocaId: string;
	targetLang: LanguageCode;
	examples: QuizExample[];
	difficultyLevel: number | null;
	utilityScore: number | null;
};

type PendingNewReviewPayload = {
	mode: 'new';
	senseNumber: number;
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: PartOfSpeech;
	targetLang: LanguageCode;
	targetText: string;
	targetDefinition: string;
	difficultyLevel: number;
	utilityScore: number;
	examples: GeneratedQuizExample[];
};

type PendingReviewPayload =
	PendingExistingReviewPayload | PendingStoredReviewPayload | PendingNewReviewPayload;

type ParsedAddVocaFormData = {
	sourceText: string;
	targetLang: LanguageCode;
	targetText: string;
	meaningHint: string;
	selectedVocaId: string;
	createdVocaId: string;
	wasAlreadyRegistered: boolean;
	pendingReviewJson: string;
	pendingReviewSignature: string;
	selectedExampleIndices: number[];
};

type SearchActionBase = {
	sourceText: string;
	targetLang: LanguageCode;
	targetText: string;
	meaningHint: string;
	options: Voca[];
	selectedVocaId?: string;
};

type SearchActionSuccess = SearchActionBase & {
	success: true;
	step: 'search';
};

type ReviewActionBase = SearchActionBase & {
	step: 'review';
	pendingReviewJson: string;
	pendingReviewSignature: string;
	reviewExamples: QuizExample[];
	reviewVoca: ReviewVocaPreview;
	selectedExampleIndices: number[];
};

type ReviewActionSuccess = ReviewActionBase & {
	success: true;
};

type CreateActionSuccess = SearchActionBase & {
	success: true;
	step: 'create';
	createdQuizCard: QuizCard;
	createdVoca: Voca;
	queuedForReview: boolean;
	wasAlreadyRegistered: boolean;
	isAlreadyLearning: boolean;
	error?: string;
};

type ActionFailure = SearchActionBase & {
	success: false;
	step: 'search' | 'create' | 'review' | 'generate-error';
	status: number;
	error: string;
	pendingReviewJson?: string;
	pendingReviewSignature?: string;
	reviewExamples?: QuizExample[];
	reviewVoca?: ReviewVocaPreview;
	selectedExampleIndices?: number[];
};

export type AddVocaActionResult =
	SearchActionSuccess | ReviewActionSuccess | CreateActionSuccess | ActionFailure;

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function getCustomInputError(fields: ParsedAddVocaFormData): string | null {
	if (fields.targetText === '' || fields.meaningHint === '') {
		return '직접 추가에는 외울 단어와 뜻 설명이 필요합니다.';
	}

	if (
		fields.sourceText.length > SOURCE_TEXT_MAX_LENGTH ||
		fields.targetText.length > TARGET_TEXT_MAX_LENGTH ||
		fields.meaningHint.length > MEANING_HINT_MAX_LENGTH
	) {
		return '입력한 단어나 뜻 설명이 너무 깁니다.';
	}

	return null;
}

function getSearchInputError(sourceText: string): string | null {
	if (sourceText === '') {
		return '검색할 단어를 입력해 주세요.';
	}

	if (!SEARCH_LETTER_PATTERN.test(sourceText)) {
		return '검색어에는 한글이나 영문이 하나 이상 포함되어야 합니다.';
	}

	return null;
}

function parseLanguageCode(
	value: FormDataEntryValue | null,
	fallback: LanguageCode = LANGUAGE_CODES.EN
): LanguageCode {
	const languageCode = String(value ?? fallback);

	return Object.values(LANGUAGE_CODES).includes(languageCode as LanguageCode)
		? (languageCode as LanguageCode)
		: fallback;
}

function parseSelectedExampleIndices(formData: FormData): number[] {
	return Array.from(
		new Set(
			formData
				.getAll('selectedExampleIndex')
				.map((value) => Number.parseInt(String(value), 10))
				.filter((value) => Number.isInteger(value) && value >= 0)
		)
	).sort((left, right) => left - right);
}

function parseAddVocaFormData(formData: FormData): ParsedAddVocaFormData {
	return {
		sourceText: normalizeWhitespace(String(formData.get('sourceText') ?? '')),
		targetLang: parseLanguageCode(formData.get('targetLang')),
		targetText: normalizeWhitespace(String(formData.get('targetText') ?? '')),
		meaningHint: normalizeWhitespace(String(formData.get('meaningHint') ?? '')),
		selectedVocaId: normalizeWhitespace(String(formData.get('selectedVocaId') ?? '')),
		createdVocaId: normalizeWhitespace(String(formData.get('createdVocaId') ?? '')),
		wasAlreadyRegistered: String(formData.get('wasAlreadyRegistered') ?? '') === 'true',
		pendingReviewJson: String(formData.get('pendingReviewJson') ?? ''),
		pendingReviewSignature: String(formData.get('pendingReviewSignature') ?? ''),
		selectedExampleIndices: parseSelectedExampleIndices(formData)
	};
}

function buildBaseResult(
	fields: ParsedAddVocaFormData,
	options: Voca[],
	selectedVocaId = fields.selectedVocaId
): SearchActionBase {
	return {
		sourceText: fields.sourceText,
		targetLang: fields.targetLang,
		targetText: fields.targetText,
		meaningHint: fields.meaningHint,
		options,
		selectedVocaId: selectedVocaId === '' ? undefined : selectedVocaId
	};
}

function buildFailure(
	step: ActionFailure['step'],
	fields: ParsedAddVocaFormData,
	options: Voca[],
	status: number,
	error: string
): ActionFailure {
	return {
		success: false,
		step,
		status,
		error,
		...buildBaseResult(fields, options)
	};
}

function buildSearchSuccess(fields: ParsedAddVocaFormData, options: Voca[]): SearchActionSuccess {
	return {
		success: true,
		step: 'search',
		...buildBaseResult(fields, options)
	};
}

function buildCreateSuccess(
	fields: ParsedAddVocaFormData,
	options: Voca[],
	createdVoca: Voca,
	createdQuizCard: QuizCard,
	wasAlreadyRegistered = false,
	isAlreadyLearning = false
): CreateActionSuccess {
	return {
		success: true,
		step: 'create',
		createdVoca,
		createdQuizCard,
		queuedForReview: false,
		wasAlreadyRegistered,
		isAlreadyLearning,
		...buildBaseResult(fields, options, createdVoca._id)
	};
}

function buildReviewExamples(pendingReview: PendingReviewPayload): QuizExample[] {
	if (pendingReview.mode === 'stored') {
		if (pendingReview.examples.length === 0) {
			throw new Error('저장할 수 있는 예문이 없습니다. 다시 생성해 주세요.');
		}

		return pendingReview.examples;
	}

	const reviewExamples = buildQuizCardCreate('preview', pendingReview.targetLang, {
		examples:
			pendingReview.mode === 'existing' ? pendingReview.seed.examples : pendingReview.examples
	}).examples;

	if (reviewExamples.length === 0) {
		throw new Error('저장할 수 있는 예문이 없습니다. 다시 생성해 주세요.');
	}

	return reviewExamples;
}

function buildReviewSuccess(
	userId: string,
	fields: ParsedAddVocaFormData,
	options: Voca[],
	reviewVoca: ReviewVocaPreview,
	pendingReview: PendingReviewPayload
): ReviewActionSuccess {
	const reviewExamples = buildReviewExamples(pendingReview);
	const pendingReviewJson = JSON.stringify(pendingReview);

	return {
		success: true,
		step: 'review',
		pendingReviewJson,
		pendingReviewSignature: signPendingReview(userId, pendingReviewJson),
		reviewExamples,
		reviewVoca,
		selectedExampleIndices: reviewExamples.map((_, index) => index),
		...buildBaseResult(fields, options)
	};
}

function buildReviewFailure(
	userId: string,
	fields: ParsedAddVocaFormData,
	options: Voca[],
	error: string,
	pendingReview: PendingReviewPayload,
	reviewVoca: ReviewVocaPreview,
	selectedExampleIndices: number[]
): ActionFailure {
	const pendingReviewJson = JSON.stringify(pendingReview);

	return {
		success: false,
		step: 'review',
		status: 400,
		error,
		pendingReviewJson,
		pendingReviewSignature: signPendingReview(userId, pendingReviewJson),
		reviewExamples: buildReviewExamples(pendingReview),
		reviewVoca,
		selectedExampleIndices,
		...buildBaseResult(fields, options)
	};
}

async function searchOptions(sourceText: string, targetLang: LanguageCode): Promise<Voca[]> {
	const options = await findVocasBySourceText(targetLang, sourceText);
	return options.filter((option) => option.utilityScore !== INVALID_UTILITY_SCORE);
}

function buildReviewVocaFromExisting(currentVoca: Voca, seed: CandidateSeed): ReviewVocaPreview {
	return {
		sourceText: currentVoca.sourceText,
		sourceDefinition: currentVoca.sourceDefinition,
		targetText: currentVoca.targetText,
		targetDefinition: currentVoca.targetDefinition,
		difficultyLevel: currentVoca.difficultyLevel ?? seed.difficultyLevel,
		utilityScore: currentVoca.utilityScore ?? seed.utilityScore
	};
}

function buildReviewVocaFromNew(
	fields: ParsedAddVocaFormData,
	draft: CandidateSeed & {
		sourceDefinition: string;
		targetDefinition: string;
	}
): ReviewVocaPreview {
	return {
		sourceText: fields.sourceText,
		sourceDefinition: draft.sourceDefinition,
		targetText: fields.targetText,
		targetDefinition: draft.targetDefinition,
		difficultyLevel: draft.difficultyLevel,
		utilityScore: draft.utilityScore
	};
}

function buildReviewVocaFromStored(currentVoca: Voca): ReviewVocaPreview {
	return {
		sourceText: currentVoca.sourceText,
		sourceDefinition: currentVoca.sourceDefinition,
		targetText: currentVoca.targetText,
		targetDefinition: currentVoca.targetDefinition,
		difficultyLevel: currentVoca.difficultyLevel,
		utilityScore: currentVoca.utilityScore
	};
}

async function isVocaInReview(userId: string, currentVoca: Voca): Promise<boolean> {
	return hasReviewByUserAndVoca(userId, currentVoca._id);
}

async function buildExistingFallback(
	userId: string,
	fields: ParsedAddVocaFormData,
	options: Voca[],
	currentVoca: Voca,
	providedSeed?: CandidateSeed
): Promise<AddVocaActionResult> {
	const currentQuizCard = await findQuizCardByVocaId(currentVoca._id);

	if (currentQuizCard != null && currentQuizCard.examples.length > 0) {
		return buildCreateSuccess(
			fields,
			options,
			currentVoca,
			currentQuizCard,
			true,
			await isVocaInReview(userId, currentVoca)
		);
	}

	const seed = providedSeed ?? (await generateQuizCardSeed(buildSeedInputFromVoca(currentVoca)));

	return buildReviewSuccess(
		userId,
		fields,
		options,
		buildReviewVocaFromExisting(currentVoca, seed),
		{
			mode: 'existing',
			vocaId: currentVoca._id,
			targetLang: currentVoca.targetLang,
			seed
		}
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value != null;
}

function parsePartOfSpeech(value: unknown): PartOfSpeech {
	if (!Object.values(PARTS_OF_SPEECH).includes(value as PartOfSpeech)) {
		throw new Error('품사 정보가 올바르지 않습니다.');
	}

	return value as PartOfSpeech;
}

function parseGeneratedExampleText(value: unknown): GeneratedExampleText {
	if (
		!isRecord(value) ||
		typeof value.languageCode !== 'string' ||
		typeof value.fullSentence !== 'string' ||
		typeof value.answerSurface !== 'string' ||
		typeof value.pronunciationText !== 'string'
	) {
		throw new Error('Invalid generated example text.');
	}

	return {
		languageCode: parseLanguageCode(value.languageCode),
		fullSentence: value.fullSentence,
		answerSurface: value.answerSurface,
		pronunciationText: value.pronunciationText
	};
}

function parseGeneratedQuizExample(value: unknown): GeneratedQuizExample {
	if (!isRecord(value) || !Array.isArray(value.texts)) {
		throw new Error('Invalid generated example.');
	}

	return {
		texts: value.texts.map(parseGeneratedExampleText)
	};
}

function parseCandidateSeed(value: unknown): CandidateSeed {
	if (
		!isRecord(value) ||
		typeof value.difficultyLevel !== 'number' ||
		typeof value.utilityScore !== 'number' ||
		!Array.isArray(value.examples)
	) {
		throw new Error('Invalid generated seed.');
	}

	return {
		difficultyLevel: value.difficultyLevel,
		utilityScore: value.utilityScore,
		examples: value.examples.map(parseGeneratedQuizExample)
	};
}

function parsePendingReviewPayload(value: string): PendingReviewPayload {
	let parsed: unknown;

	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error('검토 중인 예문 정보를 읽을 수 없습니다. 다시 생성해 주세요.');
	}

	if (!isRecord(parsed) || typeof parsed.mode !== 'string') {
		throw new Error('검토 중인 예문 정보가 올바르지 않습니다.');
	}

	if (parsed.mode === 'existing') {
		if (
			typeof parsed.vocaId !== 'string' ||
			typeof parsed.targetLang !== 'string' ||
			!isRecord(parsed.seed)
		) {
			throw new Error('기존 voca 검토 정보가 올바르지 않습니다.');
		}

		return {
			mode: 'existing',
			vocaId: parsed.vocaId,
			targetLang: parseLanguageCode(parsed.targetLang),
			seed: parseCandidateSeed(parsed.seed)
		};
	}

	if (
		parsed.mode === 'stored' &&
		typeof parsed.vocaId === 'string' &&
		typeof parsed.targetLang === 'string' &&
		typeof parsed.difficultyLevel === 'number' &&
		typeof parsed.utilityScore === 'number' &&
		Array.isArray(parsed.examples)
	) {
		return {
			mode: 'stored',
			vocaId: parsed.vocaId,
			targetLang: parseLanguageCode(parsed.targetLang),
			examples: parsed.examples,
			difficultyLevel: parsed.difficultyLevel,
			utilityScore: parsed.utilityScore
		};
	}

	if (
		parsed.mode === 'new' &&
		typeof parsed.senseNumber === 'number' &&
		Number.isInteger(parsed.senseNumber) &&
		parsed.senseNumber > 0 &&
		typeof parsed.sourceText === 'string' &&
		typeof parsed.sourceDefinition === 'string' &&
		typeof parsed.partOfSpeech === 'string' &&
		typeof parsed.targetLang === 'string' &&
		typeof parsed.targetText === 'string' &&
		typeof parsed.targetDefinition === 'string' &&
		typeof parsed.difficultyLevel === 'number' &&
		typeof parsed.utilityScore === 'number' &&
		Array.isArray(parsed.examples)
	) {
		return {
			mode: 'new',
			senseNumber: parsed.senseNumber,
			sourceText: parsed.sourceText,
			sourceDefinition: parsed.sourceDefinition,
			partOfSpeech: parsePartOfSpeech(parsed.partOfSpeech),
			targetLang: parseLanguageCode(parsed.targetLang),
			targetText: parsed.targetText,
			targetDefinition: parsed.targetDefinition,
			difficultyLevel: parsed.difficultyLevel,
			utilityScore: parsed.utilityScore,
			examples: parsed.examples.map(parseGeneratedQuizExample)
		};
	}

	throw new Error('새 voca 검토 정보가 올바르지 않습니다.');
}

function selectGeneratedExamples(
	examples: GeneratedQuizExample[],
	selectedExampleIndices: number[]
): GeneratedQuizExample[] {
	return selectedExampleIndices
		.map((index) => examples[index] ?? null)
		.filter((example): example is GeneratedQuizExample => example != null);
}

async function saveExistingReview(
	currentVoca: Voca,
	seed: CandidateSeed
): Promise<CreateVocaSuccess> {
	let nextVoca = currentVoca;
	const currentQuizCard = await findQuizCardByVocaId(currentVoca._id);

	if (currentVoca.difficultyLevel == null || currentVoca.utilityScore == null) {
		nextVoca = await saveVoca(
			applyGeneratedMetadata(currentVoca, seed.difficultyLevel, seed.utilityScore)
		);
	}

	const nextQuizCardPayload = buildQuizCardCreate(nextVoca._id, nextVoca.targetLang, seed);
	const createdQuizCard =
		currentQuizCard == null
			? await createQuizCard(nextQuizCardPayload)
			: await saveQuizCard({
					...currentQuizCard,
					examples: nextQuizCardPayload.examples
				});

	return {
		createdVoca: nextVoca,
		createdQuizCard
	};
}

async function saveStoredReview(
	currentVoca: Voca,
	examples: QuizExample[]
): Promise<CreateVocaSuccess> {
	const currentQuizCard = await findQuizCardByVocaId(currentVoca._id);

	if (currentQuizCard == null) {
		throw new Error('기존 예문을 찾을 수 없습니다.');
	}

	return {
		createdVoca: currentVoca,
		createdQuizCard: await saveQuizCard({
			...currentQuizCard,
			examples
		})
	};
}

async function savePendingReview(
	userId: string,
	pendingReview: PendingReviewPayload,
	selectedExampleIndices: number[]
): Promise<CreateVocaSuccess> {
	if (pendingReview.mode === 'stored') {
		const selectedExamples = pendingReview.examples.filter((_, index) =>
			selectedExampleIndices.includes(index)
		);
		return saveStoredReview(await getVocaById(pendingReview.vocaId), selectedExamples);
	}

	if (pendingReview.mode === 'existing') {
		const selectedExamples = selectGeneratedExamples(
			pendingReview.seed.examples,
			selectedExampleIndices
		);
		return saveExistingReview(await getVocaById(pendingReview.vocaId), {
			...pendingReview.seed,
			examples: selectedExamples
		});
	}

	const selectedExamples = selectGeneratedExamples(pendingReview.examples, selectedExampleIndices);
	const vocaData = buildCustomVocaCreate({
		originKey: buildCustomOriginKey({
			sourceText: pendingReview.sourceText,
			senseNumber: pendingReview.senseNumber,
			targetLang: pendingReview.targetLang,
			targetText: pendingReview.targetText
		}),
		createdByUserId: userId,
		sourceText: pendingReview.sourceText,
		sourceDefinition: pendingReview.sourceDefinition,
		partOfSpeech: pendingReview.partOfSpeech,
		targetLang: pendingReview.targetLang,
		targetText: pendingReview.targetText,
		targetDefinition: pendingReview.targetDefinition,
		difficultyLevel: pendingReview.difficultyLevel,
		utilityScore: pendingReview.utilityScore
	});

	return createCustomVocaBundle(vocaData, (vocaId) =>
		buildQuizCardCreate(vocaId, pendingReview.targetLang, {
			difficultyLevel: pendingReview.difficultyLevel,
			utilityScore: pendingReview.utilityScore,
			examples: selectedExamples
		})
	);
}

export async function handleSearchAction(formData: FormData): Promise<AddVocaActionResult> {
	const fields = parseAddVocaFormData(formData);
	const searchInputError = getSearchInputError(fields.sourceText);

	if (searchInputError != null) {
		return buildFailure('search', fields, [], 400, searchInputError);
	}

	return buildSearchSuccess(fields, await searchOptions(fields.sourceText, fields.targetLang));
}

export async function handleCreateAction(
	userId: string,
	formData: FormData
): Promise<AddVocaActionResult> {
	const fields = parseAddVocaFormData(formData);
	const options =
		fields.sourceText === '' ? [] : await searchOptions(fields.sourceText, fields.targetLang);

	if (fields.sourceText === '') {
		return buildFailure('create', fields, options, 400, '검색할 단어를 입력해 주세요.');
	}

	try {
		if (fields.selectedVocaId !== '') {
			const selectedOption = options.find((option) => option._id === fields.selectedVocaId);

			if (selectedOption == null) {
				return buildFailure(
					'create',
					fields,
					options,
					400,
					'검색 결과에서 사용할 항목을 선택해 주세요.'
				);
			}

			return await buildExistingFallback(userId, fields, options, selectedOption);
		}

		const customInputError = getCustomInputError(fields);

		if (customInputError != null) {
			return buildFailure('create', fields, options, 400, customInputError);
		}

		const normalizedSourceText = normalizeSourceText(fields.sourceText);
		const sourceCandidates = options.filter(
			(candidate) => normalizeSourceText(candidate.sourceText) === normalizedSourceText
		);
		const validation = await validateCustomVocaInput(
			{
				sourceText: fields.sourceText,
				targetLang: fields.targetLang,
				targetText: fields.targetText,
				meaningHint: fields.meaningHint
			},
			sourceCandidates
		);

		if (!validation.isValid) {
			return buildFailure('create', fields, options, 400, validation.rejectionMessage);
		}

		const matchingVoca =
			sourceCandidates.find((candidate) => candidate.originKey === validation.matchingOriginKey) ??
			null;
		const isSamePair =
			matchingVoca != null &&
			normalizeTargetText(matchingVoca.targetText, fields.targetLang) ===
				normalizeTargetText(fields.targetText, fields.targetLang);

		if (isSamePair) {
			return buildFailure(
				'create',
				fields,
				options,
				409,
				isCustomOriginKey(matchingVoca.originKey)
					? '이미 추가된 단어입니다.'
					: '이미 사전에 존재하는 단어입니다.'
			);
		}

		const matchedSenseNumber =
			matchingVoca == null ? null : getCustomSenseNumber(matchingVoca.originKey, fields.sourceText);
		const senseNumber =
			matchedSenseNumber ?? getNextCustomSenseNumber(fields.sourceText, sourceCandidates);
		const seed = await generateQuizCardSeed({
			sourceText: fields.sourceText,
			sourceDefinition: validation.sourceDefinition,
			partOfSpeech: validation.partOfSpeech,
			targetLang: fields.targetLang,
			targetText: fields.targetText,
			targetDefinition: validation.targetDefinition
		});
		const draft = {
			...validation,
			...seed
		};

		return buildReviewSuccess(userId, fields, options, buildReviewVocaFromNew(fields, draft), {
			mode: 'new',
			senseNumber,
			sourceText: fields.sourceText,
			sourceDefinition: draft.sourceDefinition,
			partOfSpeech: draft.partOfSpeech,
			targetLang: fields.targetLang,
			targetText: fields.targetText,
			targetDefinition: draft.targetDefinition,
			difficultyLevel: draft.difficultyLevel,
			utilityScore: draft.utilityScore,
			examples: draft.examples
		});
	} catch (error) {
		return buildFailure(
			error instanceof NoValidQuizExamplesError ? 'generate-error' : 'create',
			fields,
			options,
			400,
			error instanceof Error ? error.message : 'voca 생성에 실패했습니다.'
		);
	}
}

export async function handleSaveAction(
	userId: string,
	formData: FormData
): Promise<AddVocaActionResult> {
	const fields = parseAddVocaFormData(formData);
	let optionsPromise: Promise<Voca[]> | undefined;
	const loadOptions = () =>
		(optionsPromise ??= Promise.resolve(
			fields.sourceText === '' ? [] : searchOptions(fields.sourceText, fields.targetLang)
		));

	try {
		if (
			!verifyPendingReviewSignature(userId, fields.pendingReviewJson, fields.pendingReviewSignature)
		) {
			throw new Error('검토 중인 예문 정보가 변경되었습니다. 다시 생성해 주세요.');
		}

		const pendingReview = parsePendingReviewPayload(fields.pendingReviewJson);

		if (fields.selectedExampleIndices.length === 0) {
			const reviewVoca =
				pendingReview.mode === 'existing'
					? buildReviewVocaFromExisting(await getVocaById(pendingReview.vocaId), pendingReview.seed)
					: pendingReview.mode === 'stored'
						? buildReviewVocaFromStored(await getVocaById(pendingReview.vocaId))
						: buildReviewVocaFromNew(fields, pendingReview);

			return buildReviewFailure(
				userId,
				fields,
				await loadOptions(),
				'저장할 예문을 하나 이상 선택해 주세요.',
				pendingReview,
				reviewVoca,
				fields.selectedExampleIndices
			);
		}

		const created = await savePendingReview(userId, pendingReview, fields.selectedExampleIndices);

		return buildCreateSuccess(
			fields,
			await loadOptions(),
			created.createdVoca,
			created.createdQuizCard,
			false,
			await isVocaInReview(userId, created.createdVoca)
		);
	} catch (error) {
		const isDuplicateKey =
			typeof error === 'object' &&
			error != null &&
			'code' in error &&
			(error as { code?: unknown }).code === 11000;

		return buildFailure(
			'create',
			fields,
			await loadOptions(),
			isDuplicateKey ? 409 : 400,
			isDuplicateKey
				? '이미 추가된 단어입니다.'
				: error instanceof Error
					? error.message
					: '예문 저장에 실패했습니다.'
		);
	}
}

export async function handleMemorizeAction(
	userId: string,
	formData: FormData
): Promise<AddVocaActionResult> {
	const fields = parseAddVocaFormData(formData);
	const options =
		fields.sourceText === '' ? [] : await searchOptions(fields.sourceText, fields.targetLang);

	try {
		if (fields.createdVocaId === '') {
			return buildFailure('create', fields, options, 400, '암기할 단어를 찾을 수 없습니다.');
		}

		const currentVoca =
			options.find((option) => option._id === fields.createdVocaId) ??
			(await getVocaById(fields.createdVocaId));
		const currentQuizCard = await findQuizCardByVocaId(currentVoca._id);

		if (currentQuizCard == null || currentQuizCard.examples.length === 0) {
			return buildFailure('create', fields, options, 400, '암기할 예문을 찾을 수 없습니다.');
		}

		const unavailableVocaIds = await Promise.all([
			findPendingReportedVocaIds(),
			findPermanentlyExcludedVocaIds()
		]);
		if (unavailableVocaIds.some((vocaIds) => vocaIds.includes(currentVoca._id))) {
			return buildFailure(
				'create',
				fields,
				options,
				400,
				'신고 처리 중이거나 퀴즈에서 제외된 단어는 학습 기록에 추가할 수 없습니다.'
			);
		}

		const now = new Date();
		const currentReview = await findReviewByUserAndVoca(
			userId,
			currentVoca._id,
			KOREAN_LANGUAGE_CODE,
			currentVoca.targetLang
		);

		if (currentReview == null) {
			try {
				await assertCanStartNewVoca(userId, currentVoca._id, now);
			} catch (error) {
				if (error instanceof NewVocaLimitError) {
					return {
						...buildCreateSuccess(
							fields,
							options,
							currentVoca,
							currentQuizCard,
							fields.wasAlreadyRegistered
						),
						error: error.message
					};
				}

				throw error;
			}

			await createReview({
				userId,
				vocaId: currentVoca._id,
				promptLang: KOREAN_LANGUAGE_CODE,
				answerLang: currentVoca.targetLang,
				reviewStage: 0,
				dueAt: now.toISOString(),
				lastReviewedAt: now.toISOString(),
				correctCount: 0,
				wrongCount: 0,
				exampleScoreById: {}
			});
		} else {
			await saveReview({
				...currentReview,
				dueAt: now.toISOString()
			});
		}

		return {
			...buildCreateSuccess(
				fields,
				options,
				currentVoca,
				currentQuizCard,
				fields.wasAlreadyRegistered
			),
			queuedForReview: true,
			isAlreadyLearning: true
		};
	} catch (error) {
		return buildFailure(
			'create',
			fields,
			options,
			400,
			error instanceof Error ? error.message : '암기할 단어를 추가하지 못했습니다.'
		);
	}
}
