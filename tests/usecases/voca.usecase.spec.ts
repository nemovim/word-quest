import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	findVocasBySourceTextMock,
	findVocasByPairMock,
	getVocaByIdMock,
	createVocaMock,
	saveVocaMock,
	findQuizCardByVocaIdMock,
	createQuizCardMock,
	saveQuizCardMock,
	findReviewByUserAndVocaMock,
	hasReviewByUserAndVocaMock,
	createReviewMock,
	saveReviewMock,
	generateQuizCardSeedMock,
	validateCustomVocaInputMock,
	buildSeedInputFromVocaMock,
	buildQuizCardCreateMock,
	buildCustomVocaCreateMock,
	applyGeneratedMetadataMock,
	createCustomVocaBundleMock,
	signPendingReviewMock,
	verifyPendingReviewSignatureMock,
	assertCanStartNewVocaMock,
	NewVocaLimitErrorMock,
	NoValidQuizExamplesErrorMock
} = vi.hoisted(() => ({
	findVocasBySourceTextMock: vi.fn(),
	findVocasByPairMock: vi.fn(),
	getVocaByIdMock: vi.fn(),
	createVocaMock: vi.fn(),
	saveVocaMock: vi.fn(),
	findQuizCardByVocaIdMock: vi.fn(),
	createQuizCardMock: vi.fn(),
	saveQuizCardMock: vi.fn(),
	findReviewByUserAndVocaMock: vi.fn(),
	hasReviewByUserAndVocaMock: vi.fn(),
	createReviewMock: vi.fn(),
	saveReviewMock: vi.fn(),
	generateQuizCardSeedMock: vi.fn(),
	validateCustomVocaInputMock: vi.fn(),
	buildSeedInputFromVocaMock: vi.fn(),
	buildQuizCardCreateMock: vi.fn(),
	buildCustomVocaCreateMock: vi.fn(),
	applyGeneratedMetadataMock: vi.fn(),
	createCustomVocaBundleMock: vi.fn(),
	signPendingReviewMock: vi.fn(),
	verifyPendingReviewSignatureMock: vi.fn(),
	assertCanStartNewVocaMock: vi.fn(),
	NewVocaLimitErrorMock: class extends Error {},
	NoValidQuizExamplesErrorMock: class extends Error {}
}));

vi.mock('$lib/repositories/voca.repository', () => ({
	findVocasBySourceText: findVocasBySourceTextMock,
	findVocasByPair: findVocasByPairMock,
	getVocaById: getVocaByIdMock,
	findPermanentlyExcludedVocaIds: vi.fn().mockResolvedValue([]),
	createVoca: createVocaMock,
	normalizeSourceText: (value: string) => value.trim(),
	normalizeTargetText: (value: string) => value.trim().toLowerCase(),
	saveVoca: saveVocaMock
}));

vi.mock('$lib/repositories/quiz-card.repository', () => ({
	findQuizCardByVocaId: findQuizCardByVocaIdMock,
	createQuizCard: createQuizCardMock,
	saveQuizCard: saveQuizCardMock
}));

vi.mock('$lib/repositories/custom-voca.repository', () => ({
	createCustomVocaBundle: createCustomVocaBundleMock
}));

vi.mock('$lib/repositories/quiz-report.repository', () => ({
	findPendingReportedVocaIds: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/repositories/review.repository', () => ({
	findReviewByUserAndVoca: findReviewByUserAndVocaMock,
	hasReviewByUserAndVoca: hasReviewByUserAndVocaMock,
	createReview: createReviewMock,
	saveReview: saveReviewMock
}));

vi.mock('$lib/service/ai-judge.service', () => ({
	NoValidQuizExamplesError: NoValidQuizExamplesErrorMock,
	generateQuizCardSeed: generateQuizCardSeedMock,
	validateCustomVocaInput: validateCustomVocaInputMock,
	buildSeedInputFromVoca: buildSeedInputFromVocaMock,
	buildQuizCardCreate: buildQuizCardCreateMock
}));

vi.mock('$lib/server/pending-review-signature', () => ({
	signPendingReview: signPendingReviewMock,
	verifyPendingReviewSignature: verifyPendingReviewSignatureMock
}));

vi.mock('$lib/service/new-voca-limit.service', () => ({
	assertCanStartNewVoca: assertCanStartNewVocaMock,
	NewVocaLimitError: NewVocaLimitErrorMock
}));

vi.mock('$lib/service/voca.service', () => ({
	buildCustomVocaCreate: buildCustomVocaCreateMock,
	applyGeneratedMetadata: applyGeneratedMetadataMock
}));

import { makeQuizCard, makeReview, makeVoca } from '../helpers/factories';
import { makeFormData } from '../helpers/form-data';

import * as VocaService from '$lib/service/voca.service';
import { LANGUAGE_CODES } from '$lib/shared/types/general.type';
import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';
import {
	handleCreateAction,
	handleMemorizeAction,
	handleSaveAction,
	handleSearchAction
} from '$lib/usecases/voca.usecase';

function makeGeneratedExample(fillText = 'tree') {
	return {
		texts: [
			{
				languageCode: LANGUAGE_CODES.KO,
				fullSentence: '나무가 크다.',
				answerSurface: '나무',
				pronunciationText: '나무'
			},
			{
				languageCode: LANGUAGE_CODES.EN,
				fullSentence: `The ${fillText} is tall.`,
				answerSurface: fillText,
				pronunciationText: '트리'
			}
		]
	};
}

describe('voca.usecase', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		signPendingReviewMock.mockReturnValue('signed-review');
		verifyPendingReviewSignatureMock.mockReturnValue(true);
		assertCanStartNewVocaMock.mockResolvedValue(undefined);
		hasReviewByUserAndVocaMock.mockResolvedValue(false);
	});

	it('returns search failure when sourceText is empty', async () => {
		const result = await handleSearchAction(
			makeFormData({
				sourceText: '',
				targetLang: LANGUAGE_CODES.EN
			})
		);

		expect(result.success).toBe(false);
		if (result.success) {
			throw new Error('expected failure');
		}
		expect(result.step).toBe('search');
		expect(result.status).toBe(400);
		expect(findVocasBySourceTextMock).not.toHaveBeenCalled();
	});

	it('rejects a search made only of numbers and symbols', async () => {
		const result = await handleSearchAction(
			makeFormData({
				sourceText: ' 123-45 ',
				targetLang: LANGUAGE_CODES.EN
			})
		);

		expect(result).toMatchObject({
			success: false,
			status: 400,
			error: '검색어에는 한글이나 영문이 하나 이상 포함되어야 합니다.'
		});
		expect(findVocasBySourceTextMock).not.toHaveBeenCalled();
	});

	it('allows a search containing both letters and numbers', async () => {
		findVocasBySourceTextMock.mockResolvedValue([]);

		const result = await handleSearchAction(
			makeFormData({
				sourceText: 'B2B',
				targetLang: LANGUAGE_CODES.EN
			})
		);

		expect(result.success).toBe(true);
		expect(findVocasBySourceTextMock).toHaveBeenCalledWith(LANGUAGE_CODES.EN, 'B2B');
	});

	it('returns search results from the local voca repository', async () => {
		const options = [makeVoca()];
		findVocasBySourceTextMock.mockResolvedValue(options);

		const result = await handleSearchAction(
			makeFormData({
				sourceText: 'source-tree',
				targetLang: LANGUAGE_CODES.EN
			})
		);

		expect(findVocasBySourceTextMock).toHaveBeenCalledWith(LANGUAGE_CODES.EN, 'source-tree');
		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error('expected success');
		}
		expect(result.step).toBe('search');
		expect(result.options).toEqual(options);
	});

	it('falls back to an existing registered voca without generating examples', async () => {
		const selectedVoca = makeVoca({
			sourceText: '나무',
			targetText: 'Tree',
			normalizedTargetText: 'tree'
		});
		const currentQuizCard = makeQuizCard({
			examples: [
				{
					_id: 'example-1',
					sourceSentenceTemplate: '{{---}}가 크다.',
					sourceFillText: '나무',
					targetSentenceTemplate: 'The {{---}} is tall.',
					targetFillText: 'tree',
					targetPronunciationText: '트리',
					reportCount: 0,
					addedAt: '2026-06-23T00:00:00.000Z'
				}
			]
		});

		findVocasBySourceTextMock.mockResolvedValue([selectedVoca]);
		findQuizCardByVocaIdMock.mockResolvedValue(currentQuizCard);
		hasReviewByUserAndVocaMock.mockResolvedValue(true);

		const result = await handleCreateAction(
			'user-1',
			makeFormData({
				sourceText: ' Tree ',
				targetLang: LANGUAGE_CODES.EN,
				selectedVocaId: 'voca-1'
			})
		);

		expect(findVocasBySourceTextMock).toHaveBeenNthCalledWith(1, LANGUAGE_CODES.EN, 'Tree');
		expect(generateQuizCardSeedMock).not.toHaveBeenCalled();
		expect(result.success).toBe(true);
		if (!result.success || result.step !== 'create') {
			throw new Error('expected create success');
		}
		expect(result.createdQuizCard).toEqual(currentQuizCard);
		expect(result.wasAlreadyRegistered).toBe(true);
		expect(result.isAlreadyLearning).toBe(true);
		expect(result.selectedVocaId).toBe(selectedVoca._id);
		expect(hasReviewByUserAndVocaMock).toHaveBeenCalledOnce();
		expect(findReviewByUserAndVocaMock).not.toHaveBeenCalled();
	});

	it('generates review candidates when a dictionary voca has no quiz assets yet', async () => {
		const selectedVoca = makeVoca({ difficultyLevel: null, utilityScore: null });
		const seed = {
			difficultyLevel: 4,
			utilityScore: 4,
			examples: [makeGeneratedExample(), makeGeneratedExample('woods')]
		};
		const previewQuizCard = {
			vocaId: 'preview',
			examples: [makeQuizCard().examples[0], { ...makeQuizCard().examples[0], _id: 'example-2' }]
		};

		findVocasBySourceTextMock.mockResolvedValue([selectedVoca]);
		findQuizCardByVocaIdMock.mockResolvedValue(null);
		buildSeedInputFromVocaMock.mockReturnValue({
			sourceText: 'source-tree',
			sourceDefinition: 'source definition',
			targetLang: LANGUAGE_CODES.EN,
			targetText: 'tree',
			targetDefinition: 'a tall plant'
		});
		generateQuizCardSeedMock.mockResolvedValue(seed);
		buildQuizCardCreateMock.mockReturnValue(previewQuizCard);

		const result = await handleCreateAction(
			'user-1',
			makeFormData({
				sourceText: 'source-tree',
				targetLang: LANGUAGE_CODES.EN,
				selectedVocaId: 'voca-1'
			})
		);

		expect(generateQuizCardSeedMock).toHaveBeenCalledOnce();
		expect(result.success).toBe(true);
		if (!result.success || result.step !== 'review') {
			throw new Error('expected review success');
		}
		expect(result.reviewExamples).toEqual(previewQuizCard.examples);
	});

	it('returns a generation error without retrying when every example is invalid', async () => {
		const selectedVoca = makeVoca();
		findVocasBySourceTextMock.mockResolvedValue([selectedVoca]);
		findQuizCardByVocaIdMock.mockResolvedValue(null);
		buildSeedInputFromVocaMock.mockReturnValue({});
		generateQuizCardSeedMock.mockRejectedValue(new NoValidQuizExamplesErrorMock());

		const result = await handleCreateAction(
			'user-1',
			makeFormData({
				sourceText: selectedVoca.sourceText,
				targetLang: selectedVoca.targetLang,
				selectedVocaId: selectedVoca._id
			})
		);

		expect(generateQuizCardSeedMock).toHaveBeenCalledOnce();
		expect(result.success).toBe(false);
		if (result.success) {
			throw new Error('expected failure');
		}
		expect(result.step).toBe('generate-error');
	});

	it('saves only the selected generated examples for an existing voca review', async () => {
		const selectedVoca = makeVoca({ difficultyLevel: null, utilityScore: null });
		const filledVoca = makeVoca();
		const rawSeed = {
			difficultyLevel: 4,
			utilityScore: 4,
			examples: [makeGeneratedExample(), makeGeneratedExample('woods')]
		};
		const previewQuizCard = {
			vocaId: 'preview',
			examples: [
				makeQuizCard().examples[0],
				{
					...makeQuizCard().examples[0],
					_id: 'example-2',
					targetFillText: 'woods'
				}
			]
		};
		const savedQuizCard = makeQuizCard();
		const pendingReviewJson = JSON.stringify({
			mode: 'existing',
			vocaId: 'voca-1',
			targetLang: LANGUAGE_CODES.EN,
			seed: rawSeed
		});

		findVocasBySourceTextMock.mockResolvedValue([selectedVoca]);
		getVocaByIdMock.mockResolvedValue(selectedVoca);
		findQuizCardByVocaIdMock.mockResolvedValue(null);
		applyGeneratedMetadataMock.mockReturnValue(filledVoca);
		saveVocaMock.mockResolvedValue(filledVoca);
		buildQuizCardCreateMock.mockReturnValue(previewQuizCard);
		createQuizCardMock.mockResolvedValue(savedQuizCard);

		const result = await handleSaveAction(
			'user-1',
			makeFormData({
				sourceText: 'source-tree',
				targetLang: LANGUAGE_CODES.EN,
				selectedVocaId: 'voca-1',
				pendingReviewJson,
				pendingReviewSignature: 'signed-review',
				selectedExampleIndex: '1'
			})
		);

		expect(VocaService.applyGeneratedMetadata).toHaveBeenCalledWith(selectedVoca, 4, 4);
		expect(buildQuizCardCreateMock).toHaveBeenCalledWith(
			'voca-1',
			LANGUAGE_CODES.EN,
			expect.objectContaining({
				examples: [rawSeed.examples[1]]
			})
		);
		expect(result.success).toBe(true);
		if (!result.success || result.step !== 'create') {
			throw new Error('expected create success');
		}
		expect(result.createdVoca).toEqual(filledVoca);
		expect(result.createdQuizCard).toEqual(savedQuizCard);
	});

	it('returns review candidates for a new custom voca instead of saving immediately', async () => {
		const draft = {
			sourceDefinition: 'move to another place',
			partOfSpeech: PARTS_OF_SPEECH.VERB,
			targetDefinition: 'to move from one place to another',
			difficultyLevel: 2,
			utilityScore: 5,
			examples: [makeGeneratedExample('go')]
		};
		const previewQuizCard = {
			vocaId: 'preview',
			examples: makeQuizCard().examples
		};

		findVocasBySourceTextMock.mockResolvedValueOnce([]);
		validateCustomVocaInputMock.mockResolvedValue({
			isValid: true,
			rejectionMessage: '',
			matchingOriginKey: '',
			sourceDefinition: draft.sourceDefinition,
			partOfSpeech: draft.partOfSpeech,
			targetDefinition: draft.targetDefinition
		});
		generateQuizCardSeedMock.mockResolvedValue({
			difficultyLevel: draft.difficultyLevel,
			utilityScore: draft.utilityScore,
			examples: draft.examples
		});
		buildQuizCardCreateMock.mockReturnValue(previewQuizCard);

		const result = await handleCreateAction(
			'user-1',
			makeFormData({
				sourceText: 'source-go',
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'go',
				meaningHint: 'move to another place'
			})
		);

		expect(validateCustomVocaInputMock).toHaveBeenCalledWith(
			{
				sourceText: 'source-go',
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'go',
				meaningHint: 'move to another place'
			},
			[]
		);
		expect(result.success).toBe(true);
		if (!result.success || result.step !== 'review') {
			throw new Error('expected review success');
		}
		expect(result.pendingReviewJson).toContain('"mode":"new"');
		expect(result.reviewVoca.targetDefinition).toBe(draft.targetDefinition);
	});

	it('rejects a custom pair when the same dictionary sense already exists', async () => {
		const dictionaryVoca = makeVoca({
			originKey: 'krdict:1:1:en:qualified',
			sourceText: '적격',
			targetText: 'being qualified',
			normalizedTargetText: 'being qualified'
		});
		findVocasBySourceTextMock.mockResolvedValue([dictionaryVoca]);
		validateCustomVocaInputMock.mockResolvedValue({
			isValid: true,
			rejectionMessage: '',
			matchingOriginKey: dictionaryVoca.originKey,
			sourceDefinition: dictionaryVoca.sourceDefinition,
			partOfSpeech: dictionaryVoca.partOfSpeech,
			targetDefinition: dictionaryVoca.targetDefinition
		});

		const result = await handleCreateAction(
			'user-1',
			makeFormData({
				sourceText: '적격',
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'being qualified',
				meaningHint: '어떤 일에 자격이 알맞음'
			})
		);

		expect(result).toMatchObject({
			success: false,
			status: 409,
			error: '이미 사전에 존재하는 단어입니다.'
		});
		expect(generateQuizCardSeedMock).not.toHaveBeenCalled();
	});

	it('reports an already-added custom pair with the same sense', async () => {
		const customVoca = makeVoca({
			originKey: 'custom:적격:1:en:being qualified',
			sourceText: '적격',
			targetText: 'being qualified',
			normalizedTargetText: 'being qualified'
		});
		findVocasBySourceTextMock.mockResolvedValue([customVoca]);
		validateCustomVocaInputMock.mockResolvedValue({
			isValid: true,
			rejectionMessage: '',
			matchingOriginKey: customVoca.originKey,
			sourceDefinition: customVoca.sourceDefinition,
			partOfSpeech: customVoca.partOfSpeech,
			targetDefinition: customVoca.targetDefinition
		});

		const result = await handleCreateAction(
			'user-1',
			makeFormData({
				sourceText: '적격',
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'being qualified',
				meaningHint: '어떤 일에 자격이 알맞음'
			})
		);

		expect(result).toMatchObject({
			success: false,
			status: 409,
			error: '이미 추가된 단어입니다.'
		});
	});

	it('allocates a new sense number for the same pair with a different meaning', async () => {
		const existingSense = makeVoca({
			originKey: 'custom:표현:1:en:expression',
			sourceText: '표현',
			targetText: 'expression',
			normalizedTargetText: 'expression'
		});
		const seed = {
			difficultyLevel: 4,
			utilityScore: 3,
			examples: [makeGeneratedExample('expression')]
		};
		findVocasBySourceTextMock.mockResolvedValue([existingSense]);
		validateCustomVocaInputMock.mockResolvedValue({
			isValid: true,
			rejectionMessage: '',
			matchingOriginKey: '',
			sourceDefinition: '감정을 밖으로 드러냄.',
			partOfSpeech: PARTS_OF_SPEECH.NOUN,
			targetDefinition: 'the act of showing a feeling'
		});
		generateQuizCardSeedMock.mockResolvedValue(seed);
		buildQuizCardCreateMock.mockReturnValue(makeQuizCard());

		const result = await handleCreateAction(
			'user-1',
			makeFormData({
				sourceText: '표현',
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'expression',
				meaningHint: '감정을 드러내는 행위'
			})
		);

		expect(result.success).toBe(true);
		if (!result.success || result.step !== 'review') {
			throw new Error('expected review success');
		}
		expect(result.pendingReviewJson).toContain('"senseNumber":2');
	});

	it('rejects an invalid user-proposed pair before generating examples', async () => {
		findVocasBySourceTextMock.mockResolvedValue([]);
		validateCustomVocaInputMock.mockResolvedValue({
			isValid: false,
			rejectionMessage: '두 표현의 뜻이 서로 대응하지 않습니다.',
			matchingOriginKey: '',
			sourceDefinition: '',
			partOfSpeech: PARTS_OF_SPEECH.NOUN,
			targetDefinition: ''
		});

		const result = await handleCreateAction(
			'user-1',
			makeFormData({
				sourceText: '적격',
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'apple',
				meaningHint: '자격이 알맞음'
			})
		);

		expect(result).toMatchObject({
			success: false,
			error: '두 표현의 뜻이 서로 대응하지 않습니다.'
		});
		expect(generateQuizCardSeedMock).not.toHaveBeenCalled();
	});

	it('adds a created voca to review without recording an answer', async () => {
		const createdVoca = makeVoca();
		const createdQuizCard = makeQuizCard();
		findVocasBySourceTextMock.mockResolvedValue([createdVoca]);
		getVocaByIdMock.mockResolvedValue(createdVoca);
		findQuizCardByVocaIdMock.mockResolvedValue(createdQuizCard);
		findReviewByUserAndVocaMock.mockResolvedValue(null);

		const result = await handleMemorizeAction(
			'user-1',
			makeFormData({
				sourceText: createdVoca.sourceText,
				targetLang: createdVoca.targetLang,
				createdVocaId: createdVoca._id
			})
		);

		expect(createReviewMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'user-1',
				vocaId: createdVoca._id,
				reviewStage: 0,
				correctCount: 0,
				wrongCount: 0,
				exampleScoreById: {}
			})
		);
		expect(assertCanStartNewVocaMock).toHaveBeenCalledWith(
			'user-1',
			createdVoca._id,
			expect.any(Date)
		);
		expect(result.success).toBe(true);
		if (!result.success || result.step !== 'create') {
			throw new Error('expected create success');
		}
		expect(result.queuedForReview).toBe(true);
	});

	it('keeps the created panel visible when the new-voca limit blocks memorizing', async () => {
		const createdVoca = makeVoca();
		const createdQuizCard = makeQuizCard();
		findVocasBySourceTextMock.mockResolvedValue([createdVoca]);
		getVocaByIdMock.mockResolvedValue(createdVoca);
		findQuizCardByVocaIdMock.mockResolvedValue(createdQuizCard);
		findReviewByUserAndVocaMock.mockResolvedValue(null);
		assertCanStartNewVocaMock.mockRejectedValue(
			new NewVocaLimitErrorMock('최근 12시간 신규 단어 제한')
		);

		const result = await handleMemorizeAction(
			'user-1',
			makeFormData({
				sourceText: createdVoca.sourceText,
				targetLang: createdVoca.targetLang,
				createdVocaId: createdVoca._id
			})
		);

		expect(result).toMatchObject({
			success: true,
			step: 'create',
			queuedForReview: false,
			error: '최근 12시간 신규 단어 제한'
		});
		expect(createReviewMock).not.toHaveBeenCalled();
	});

	it('makes an existing review due without changing its statistics', async () => {
		const createdVoca = makeVoca();
		const currentReview = makeReview({
			correctCount: 3,
			wrongCount: 2,
			reviewStage: 4,
			exampleScoreById: { 'example-1': 3 }
		});
		findVocasBySourceTextMock.mockResolvedValue([createdVoca]);
		getVocaByIdMock.mockResolvedValue(createdVoca);
		findQuizCardByVocaIdMock.mockResolvedValue(makeQuizCard());
		findReviewByUserAndVocaMock.mockResolvedValue(currentReview);

		await handleMemorizeAction(
			'user-1',
			makeFormData({
				sourceText: createdVoca.sourceText,
				targetLang: createdVoca.targetLang,
				createdVocaId: createdVoca._id
			})
		);

		expect(saveReviewMock).toHaveBeenCalledWith({
			...currentReview,
			dueAt: expect.any(String)
		});
		expect(saveReviewMock.mock.calls[0][0]).toMatchObject({
			correctCount: 3,
			wrongCount: 2,
			reviewStage: 4,
			exampleScoreById: { 'example-1': 3 }
		});
	});

	it('requires at least one selected example when saving a review', async () => {
		const pendingReviewJson = JSON.stringify({
			mode: 'new',
			senseNumber: 1,
			sourceText: 'source-go',
			sourceDefinition: 'move to another place',
			partOfSpeech: PARTS_OF_SPEECH.VERB,
			targetLang: LANGUAGE_CODES.EN,
			targetText: 'go',
			targetDefinition: 'to move from one place to another',
			difficultyLevel: 2,
			utilityScore: 5,
			examples: [makeGeneratedExample('go')]
		});
		const previewQuizCard = {
			vocaId: 'preview',
			examples: makeQuizCard().examples
		};

		findVocasBySourceTextMock.mockResolvedValue([]);
		buildQuizCardCreateMock.mockReturnValue(previewQuizCard);

		const result = await handleSaveAction(
			'user-1',
			makeFormData({
				sourceText: 'source-go',
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'go',
				meaningHint: 'move to another place',
				pendingReviewJson,
				pendingReviewSignature: 'signed-review'
			})
		);

		expect(result.success).toBe(false);
		if (result.success) {
			throw new Error('expected failure');
		}
		expect(result.step).toBe('review');
		expect(result.error).toContain('하나 이상 선택');
	});

	it('saves a custom voca and its quiz card through one bundle operation', async () => {
		const generatedExample = makeGeneratedExample('being qualified');
		const pendingReviewJson = JSON.stringify({
			mode: 'new',
			senseNumber: 2,
			sourceText: '적격',
			sourceDefinition: '어떤 일에 필요한 자격을 갖춤.',
			partOfSpeech: PARTS_OF_SPEECH.NOUN,
			targetLang: LANGUAGE_CODES.EN,
			targetText: 'being qualified',
			targetDefinition: 'having the required qualifications',
			difficultyLevel: 5,
			utilityScore: 3,
			examples: [generatedExample]
		});
		const vocaData = { originKey: 'custom:적격:2:en:being qualified' };
		const createdVoca = makeVoca({
			_id: 'voca-new',
			originKey: vocaData.originKey,
			sourceText: '적격',
			targetText: 'being qualified'
		});
		const createdQuizCard = makeQuizCard({ vocaId: createdVoca._id });

		findVocasBySourceTextMock.mockResolvedValue([createdVoca]);
		buildCustomVocaCreateMock.mockReturnValue(vocaData);
		buildQuizCardCreateMock.mockReturnValue(createdQuizCard);
		createCustomVocaBundleMock.mockImplementation(async (_input, buildQuizCard) => {
			buildQuizCard(createdVoca._id);
			return { createdVoca, createdQuizCard };
		});
		findReviewByUserAndVocaMock.mockResolvedValue(null);

		const result = await handleSaveAction(
			'user-1',
			makeFormData({
				sourceText: '적격',
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'being qualified',
				meaningHint: '자격이 알맞음',
				pendingReviewJson,
				pendingReviewSignature: 'signed-review',
				selectedExampleIndex: '0'
			})
		);

		expect(buildCustomVocaCreateMock).toHaveBeenCalledWith(
			expect.objectContaining({
				originKey: 'custom:적격:2:en:being qualified',
				createdByUserId: 'user-1'
			})
		);
		expect(createCustomVocaBundleMock).toHaveBeenCalledOnce();
		expect(findVocasBySourceTextMock).toHaveBeenCalledOnce();
		expect(buildQuizCardCreateMock).toHaveBeenCalledWith(
			createdVoca._id,
			LANGUAGE_CODES.EN,
			expect.objectContaining({ examples: [generatedExample] })
		);
		expect(result.success).toBe(true);
	});

	it('rejects a modified pending review before saving', async () => {
		verifyPendingReviewSignatureMock.mockReturnValue(false);
		findVocasBySourceTextMock.mockResolvedValue([]);

		const result = await handleSaveAction(
			'user-1',
			makeFormData({
				sourceText: '적격',
				targetLang: LANGUAGE_CODES.EN,
				pendingReviewJson: '{"mode":"new"}',
				pendingReviewSignature: 'invalid',
				selectedExampleIndex: '0'
			})
		);

		expect(result).toMatchObject({
			success: false,
			error: '검토 중인 예문 정보가 변경되었습니다. 다시 생성해 주세요.'
		});
		expect(createCustomVocaBundleMock).not.toHaveBeenCalled();
	});
});
