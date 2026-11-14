import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	makeAnswerMemo,
	makeQuizCard,
	makeQuizExample,
	makeReview,
	makeUser,
	makeVoca
} from '../helpers/factories';

import * as QuizCardRepository from '$lib/repositories/quiz-card.repository';
import * as QuizReportRepository from '$lib/repositories/quiz-report.repository';
import * as ReviewRepository from '$lib/repositories/review.repository';
import * as VocaRepository from '$lib/repositories/voca.repository';
import * as AiJudgeService from '$lib/service/ai-judge.service';
import * as AnswerMemoService from '$lib/service/answer-memo.service';
import * as NewVocaLimitService from '$lib/service/new-voca-limit.service';
import * as UserService from '$lib/service/user.service';
import { AI_JUDGE_REASON_CODES } from '$lib/shared/types/general.type';
import {
	AI_JUDGE_REASON_LABELS,
	QUIZ_FEEDBACK_REASONS
} from '$lib/shared/utils/quiz-feedback.util';
import * as ReviewUtil from '$lib/shared/utils/review.util';
import {
	checkQuizAnswer,
	judgeQuizAnswer,
	loadQuizPage,
	passQuizAnswer,
	revealQuizAnswer
} from '$lib/usecases/quiz.usecase';

const baseRequest = {
	user: makeUser(),
	vocaId: 'voca-1',
	quizExampleId: 'example-1',
	promptLang: 'ko' as const,
	answerLang: 'en' as const
};

function mockBaseReads() {
	vi.spyOn(QuizCardRepository, 'findQuizCardByVocaId').mockResolvedValue(makeQuizCard());
	vi.spyOn(VocaRepository, 'getVocaById').mockResolvedValue(makeVoca());
	vi.spyOn(VocaRepository, 'updateVocaDifficultyIfCurrent').mockResolvedValue(makeVoca());
	vi.spyOn(VocaRepository, 'findPermanentlyExcludedVocaIds').mockResolvedValue([]);
	vi.spyOn(ReviewRepository, 'findReviewByUserAndVoca').mockResolvedValue(makeReview());
	vi.spyOn(ReviewRepository, 'findReviewVocaIdsByUser').mockResolvedValue(['voca-1']);
	vi.spyOn(ReviewRepository, 'countAnsweredReviewsByVoca').mockResolvedValue(1);
	vi.spyOn(ReviewRepository, 'findReviewedVocaIdsByUserDirection').mockResolvedValue([]);
	vi.spyOn(QuizReportRepository, 'findPendingReportedVocaIds').mockResolvedValue([]);
	vi.spyOn(QuizReportRepository, 'hasPendingReportForVoca').mockResolvedValue(false);
	vi.spyOn(ReviewRepository, 'findRecentDistinctAnsweredReviews').mockResolvedValue([
		makeReview({ correctCount: 1 })
	]);
	vi.spyOn(ReviewRepository, 'upsertReview').mockImplementation(async (review) =>
		makeReview(review)
	);
	vi.spyOn(NewVocaLimitService, 'getRemainingNewVocaCount').mockResolvedValue(40);
	vi.spyOn(NewVocaLimitService, 'assertCanStartNewVoca').mockResolvedValue();
	vi.spyOn(VocaRepository, 'findVocaByIds').mockResolvedValue([makeVoca()]);
	vi.spyOn(VocaRepository, 'findVocaDifficultiesByIds').mockResolvedValue([makeVoca()]);
	vi.spyOn(UserService, 'rebuildUserLevel').mockImplementation((user) => user);
	vi.spyOn(UserService, 'saveUser').mockImplementation(async (user) => user);
}

describe('quiz.usecase', () => {
	it('derives stressed IPA only in revealed English feedback from stored CMU pronunciation', async () => {
		mockBaseReads();
		vi.mocked(QuizCardRepository.findQuizCardByVocaId).mockResolvedValue(
			makeQuizCard({ examples: [makeQuizExample({ targetPronunciationArpabet: 'AE1 P AH0 L' })] })
		);
		const revealed = await revealQuizAnswer(baseRequest);
		expect(revealed).toMatchObject({ correctAnswer: 'apple', pronunciationIpa: '/ˈæpəl/' });
		const result = await checkQuizAnswer({ ...baseRequest, answerText: 'apple' });
		expect(result).toMatchObject({ status: 'correct', pronunciationIpa: '/ˈæpəl/' });
	});

	it('does not fail the result for missing or malformed older pronunciation data', async () => {
		mockBaseReads();
		vi.mocked(QuizCardRepository.findQuizCardByVocaId).mockResolvedValue(
			makeQuizCard({ examples: [makeQuizExample({ targetPronunciationArpabet: 'bad data' })] })
		);
		expect(await revealQuizAnswer(baseRequest)).not.toHaveProperty('pronunciationIpa');
	});

	it('does not guess between dictionary pronunciations for older examples', async () => {
		mockBaseReads();
		vi.mocked(QuizCardRepository.findQuizCardByVocaId).mockResolvedValue(
			makeQuizCard({
				examples: [
					makeQuizExample({ targetFillText: 'read', targetSentenceTemplate: 'I {{---}} books.' })
				]
			})
		);
		expect(await revealQuizAnswer(baseRequest)).not.toHaveProperty('pronunciationIpa');
	});

	it('reveals the final answer without recording an additional review result', async () => {
		mockBaseReads();
		expect(await revealQuizAnswer(baseRequest)).toEqual({
			correctAnswer: 'apple',
			pronunciationText: makeQuizExample().targetPronunciationText,
			pronunciationIpa: '/ˈæpəl/'
		});
		expect(ReviewRepository.upsertReview).not.toHaveBeenCalled();
	});
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		mockBaseReads();
	});

	it('accepts only exact normalized answers and persists the review outcome', async () => {
		const nextReview = { ...makeReview(), reviewStage: 3 };
		vi.spyOn(ReviewUtil, 'applyCorrectToReview').mockReturnValue(nextReview);
		const findCachedJudgeSpy = vi.spyOn(AnswerMemoService, 'findCachedJudge');
		const judgeAnswerSpy = vi.spyOn(AiJudgeService, 'judgeAnswer');

		const result = await checkQuizAnswer({
			...baseRequest,
			answerText: 'APPLE'
		});

		expect(result.status).toBe('correct');
		if (result.status !== 'correct') {
			throw new Error('expected correct');
		}
		expect(result.reasonLabel).toBe(QUIZ_FEEDBACK_REASONS.CORRECT);
		expect(ReviewUtil.applyCorrectToReview).toHaveBeenCalledWith(
			expect.any(Object),
			'example-1',
			expect.any(Date)
		);
		expect(findCachedJudgeSpy).not.toHaveBeenCalled();
		expect(judgeAnswerSpy).not.toHaveBeenCalled();
		expect(UserService.saveUser).not.toHaveBeenCalled();
		expect(ReviewRepository.countAnsweredReviewsByVoca).toHaveBeenCalledWith('voca-1', 'ko', 'en');
		expect(VocaRepository.updateVocaDifficultyIfCurrent).toHaveBeenCalledWith('voca-1', 3, 2.93);
	});

	it('returns feedback without recording an intermediate wrong answer', async () => {
		const cachedMemo = makeAnswerMemo();
		vi.spyOn(AnswerMemoService, 'findCachedJudge').mockResolvedValue(cachedMemo);
		const upsertReviewSpy = vi.spyOn(ReviewRepository, 'upsertReview');
		const judgeAnswerSpy = vi.spyOn(AiJudgeService, 'judgeAnswer');

		const result = await checkQuizAnswer({
			...baseRequest,
			answerText: 'pear'
		});

		expect(result).toEqual({
			status: 'wrong',
			reasonCode: AI_JUDGE_REASON_CODES.TYPO,
			reasonLabel: AI_JUDGE_REASON_LABELS[AI_JUDGE_REASON_CODES.TYPO],
			hintText: 'small spelling issue',
			spellingDistance: null,
			initialHint: 'a…',
			canJudge: true,
			canRegenerate: false
		});
		expect(upsertReviewSpy).not.toHaveBeenCalled();
		expect(judgeAnswerSpy).not.toHaveBeenCalled();
	});

	it('records the final wrong attempt as a pass', async () => {
		const result = await checkQuizAnswer({
			...baseRequest,
			answerText: 'pear',
			isRetry: true,
			passOnWrong: true
		});

		expect(result).toMatchObject({ status: 'pass', correctAnswer: 'apple' });
		expect(ReviewRepository.upsertReview).toHaveBeenCalledWith(
			expect.objectContaining({ reviewStage: 0, wrongCount: 1 })
		);
	});

	it('accepts a correct answer on the final attempt', async () => {
		const result = await checkQuizAnswer({
			...baseRequest,
			answerText: 'apple',
			isRetry: true,
			passOnWrong: true
		});

		expect(result.status).toBe('correct');
	});

	it('loads new quiz candidates without creating reviews or saving user level', async () => {
		vi.spyOn(ReviewRepository, 'findDueReviewGroupsByUser').mockResolvedValue({
			reviewed: [],
			new: []
		});
		vi.spyOn(QuizCardRepository, 'findNewQuizCandidates').mockResolvedValue([
			{ voca: makeVoca(), quizCard: makeQuizCard() }
		]);

		const result = await loadQuizPage(baseRequest.user);

		expect(result.encounters).toHaveLength(1);
		expect(result.encounters[0]?.reviewStage).toBe(0);
		expect(result.encounters[0]?.isNew).toBe(true);
		expect(ReviewRepository.upsertReview).not.toHaveBeenCalled();
		expect(UserService.saveUser).not.toHaveBeenCalled();
	});

	it('uses only due reviews when fewer than nine are available', async () => {
		const reviewed = ['review-2', 'review-1'].map((vocaId) =>
			makeReview({ _id: `review-${vocaId}`, vocaId, correctCount: 1 })
		);
		const queuedNew = makeReview({
			_id: 'queued-new',
			vocaId: 'queued-new',
			correctCount: 0,
			wrongCount: 0
		});
		const dueVocaIds = [...reviewed.map((review) => review.vocaId), queuedNew.vocaId];
		vi.spyOn(ReviewRepository, 'findDueReviewGroupsByUser').mockResolvedValue({
			reviewed,
			new: [queuedNew]
		});
		vi.spyOn(VocaRepository, 'findVocaByIds').mockResolvedValue(
			dueVocaIds.map((_id) => makeVoca({ _id }))
		);
		vi.spyOn(QuizCardRepository, 'findQuizCardsByVocaIds').mockResolvedValue(
			dueVocaIds.map((vocaId) =>
				makeQuizCard({ vocaId, examples: [makeQuizExample({ _id: `example-${vocaId}` })] })
			)
		);
		const findCandidates = vi.spyOn(QuizCardRepository, 'findNewQuizCandidates').mockResolvedValue([
			{
				voca: makeVoca({ _id: 'selected-new' }),
				quizCard: makeQuizCard({
					vocaId: 'selected-new',
					examples: [makeQuizExample({ _id: 'example-selected-new' })]
				})
			}
		]);

		const result = await loadQuizPage(baseRequest.user);

		expect(result.encounters.map((encounter) => encounter.vocaId)).toEqual([
			'review-2',
			'review-1'
		]);
		expect(result.encounters.every((encounter) => !encounter.isNew)).toBe(true);
		expect(findCandidates).not.toHaveBeenCalled();
	});

	it('does not include new words when nine due reviews fill the session', async () => {
		const reviewed = Array.from({ length: 9 }, (_, index) => {
			const vocaId = `review-${index + 1}`;
			return makeReview({ _id: `review-record-${index + 1}`, vocaId, correctCount: 1 });
		});
		const vocaIds = reviewed.map((review) => review.vocaId);
		vi.spyOn(ReviewRepository, 'findDueReviewGroupsByUser').mockResolvedValue({
			reviewed,
			new: [makeReview({ vocaId: 'queued-new', correctCount: 0, wrongCount: 0 })]
		});
		vi.spyOn(VocaRepository, 'findVocaByIds').mockResolvedValue(
			vocaIds.map((_id) => makeVoca({ _id }))
		);
		vi.spyOn(QuizCardRepository, 'findQuizCardsByVocaIds').mockResolvedValue(
			vocaIds.map((vocaId) =>
				makeQuizCard({ vocaId, examples: [makeQuizExample({ _id: `example-${vocaId}` })] })
			)
		);
		const findCandidatesSpy = vi
			.spyOn(QuizCardRepository, 'findNewQuizCandidates')
			.mockResolvedValue([]);

		const result = await loadQuizPage(baseRequest.user);

		expect(result.encounters).toHaveLength(9);
		expect(result.encounters.every((encounter) => !encounter.isNew)).toBe(true);
		expect(findCandidatesSpy).not.toHaveBeenCalled();
		expect(ReviewRepository.findReviewedVocaIdsByUserDirection).not.toHaveBeenCalled();
	});

	it('does not fill missing due review slots with new words', async () => {
		const reviewed = Array.from({ length: 10 }, (_, index) =>
			makeReview({ vocaId: `due-${index}`, correctCount: 1 })
		);
		vi.spyOn(ReviewRepository, 'findDueReviewGroupsByUser').mockResolvedValue({
			reviewed,
			new: []
		});
		vi.mocked(ReviewRepository.findReviewedVocaIdsByUserDirection).mockResolvedValue(
			reviewed.map(({ vocaId }) => vocaId)
		);
		vi.mocked(VocaRepository.findVocaByIds).mockResolvedValue(
			reviewed.map(({ vocaId }) => makeVoca({ _id: vocaId }))
		);
		vi.spyOn(QuizCardRepository, 'findQuizCardsByVocaIds').mockResolvedValue(
			reviewed.slice(1).map(({ vocaId }) => makeQuizCard({ vocaId }))
		);
		const candidates = vi
			.spyOn(QuizCardRepository, 'findNewQuizCandidates')
			.mockResolvedValue([
				{ voca: makeVoca({ _id: 'new-word' }), quizCard: makeQuizCard({ vocaId: 'new-word' }) }
			]);

		const result = await loadQuizPage(baseRequest.user);

		expect(result.encounters.map(({ vocaId }) => vocaId)).toEqual([
			'due-1',
			'due-2',
			'due-3',
			'due-4',
			'due-5',
			'due-6',
			'due-7',
			'due-8'
		]);
		expect(candidates).not.toHaveBeenCalled();
	});

	it('does not save a quiz result for a word with a pending report from any user', async () => {
		vi.mocked(QuizReportRepository.hasPendingReportForVoca).mockResolvedValue(true);
		const upsertReviewSpy = vi.spyOn(ReviewRepository, 'upsertReview');

		await expect(passQuizAnswer(baseRequest)).rejects.toThrow(
			'신고 처리 중이거나 퀴즈에서 제외된 단어는 학습 기록에 저장할 수 없습니다.'
		);
		expect(upsertReviewSpy).not.toHaveBeenCalled();
	});

	it('does not save a result for a permanently excluded word', async () => {
		vi.mocked(VocaRepository.getVocaById).mockResolvedValue(
			makeVoca({ quizExcludedByReportId: 'report-1' })
		);

		await expect(passQuizAnswer(baseRequest)).rejects.toThrow(
			'신고 처리 중이거나 퀴즈에서 제외된 단어는 학습 기록에 저장할 수 없습니다.'
		);
		expect(ReviewRepository.upsertReview).not.toHaveBeenCalled();
	});

	it.each([
		{ utilityScore: 1.9 },
		{ utilityScore: 0 },
		{ utilityScore: 4, scoreEvaluationDeferred: true }
	])('does not save a result for excluded or deferred scoring: %o', async (attributes) => {
		vi.mocked(VocaRepository.getVocaById).mockResolvedValue(makeVoca(attributes));
		await expect(passQuizAnswer(baseRequest)).rejects.toThrow('퀴즈에서 제외된 단어');
		expect(ReviewRepository.upsertReview).not.toHaveBeenCalled();
	});

	it('reuses the word already loaded by the check endpoint', async () => {
		await checkQuizAnswer({ ...baseRequest, answerText: 'apple' }, makeVoca());
		expect(VocaRepository.getVocaById).not.toHaveBeenCalled();
	});

	it('excludes words with pending reports from every user quiz', async () => {
		const findDueReviewsSpy = vi
			.spyOn(ReviewRepository, 'findDueReviewGroupsByUser')
			.mockResolvedValue({ reviewed: [], new: [] });
		vi.mocked(QuizReportRepository.findPendingReportedVocaIds).mockResolvedValue(['voca-1']);
		const findCandidatesSpy = vi
			.spyOn(QuizCardRepository, 'findNewQuizCandidates')
			.mockResolvedValue([]);

		const result = await loadQuizPage(makeUser({ _id: 'another-user' }));

		expect(result.encounters).toEqual([]);
		expect(findCandidatesSpy).toHaveBeenCalledWith(
			expect.objectContaining({ excludedVocaIds: ['voca-1'] })
		);
		expect(findDueReviewsSpy).toHaveBeenCalledWith(
			'another-user',
			'promptLang',
			'ko',
			expect.any(Date),
			9,
			['voca-1']
		);
	});

	it('excludes permanently blocked words from due reviews and new candidates', async () => {
		vi.spyOn(ReviewRepository, 'findDueReviewGroupsByUser').mockResolvedValue({
			reviewed: [],
			new: []
		});
		vi.mocked(VocaRepository.findPermanentlyExcludedVocaIds).mockResolvedValue(['voca-1']);
		const findCandidatesSpy = vi
			.spyOn(QuizCardRepository, 'findNewQuizCandidates')
			.mockResolvedValue([]);

		const result = await loadQuizPage(baseRequest.user);

		expect(result.encounters).toEqual([]);
		expect(findCandidatesSpy).toHaveBeenCalledWith(
			expect.objectContaining({ excludedVocaIds: ['voca-1'] })
		);
	});

	it('requests nine candidates regardless of the former new-word quota', async () => {
		vi.spyOn(ReviewRepository, 'findDueReviewGroupsByUser').mockResolvedValue({
			reviewed: [],
			new: []
		});
		vi.mocked(NewVocaLimitService.getRemainingNewVocaCount).mockResolvedValue(2);
		const findCandidatesSpy = vi
			.spyOn(QuizCardRepository, 'findNewQuizCandidates')
			.mockResolvedValue([]);

		await loadQuizPage(baseRequest.user);

		expect(findCandidatesSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 9
			})
		);
	});

	it('excludes previously reviewed words from new candidates', async () => {
		vi.spyOn(ReviewRepository, 'findDueReviewGroupsByUser').mockResolvedValue({
			reviewed: [],
			new: []
		});
		vi.mocked(ReviewRepository.findReviewedVocaIdsByUserDirection).mockResolvedValue([
			'voca-reviewed'
		]);
		const findCandidatesSpy = vi
			.spyOn(QuizCardRepository, 'findNewQuizCandidates')
			.mockResolvedValue([]);

		await loadQuizPage(baseRequest.user);

		expect(findCandidatesSpy).toHaveBeenCalledWith(
			expect.objectContaining({ excludedVocaIds: ['voca-reviewed'] })
		);
	});

	it('reports an empty pool independently of the former quota', async () => {
		vi.spyOn(ReviewRepository, 'findDueReviewGroupsByUser').mockResolvedValue({
			reviewed: [],
			new: []
		});
		vi.mocked(NewVocaLimitService.getRemainingNewVocaCount).mockResolvedValue(0);
		vi.spyOn(QuizCardRepository, 'findNewQuizCandidates').mockResolvedValue([]);

		const result = await loadQuizPage(baseRequest.user);

		expect(result).toMatchObject({
			encounters: [],
			isEmpty: true,
			emptyReason: 'no-quiz'
		});
	});

	it('does not label an answered stage-zero review as new', async () => {
		vi.spyOn(ReviewRepository, 'findDueReviewGroupsByUser').mockResolvedValue({
			reviewed: [makeReview({ reviewStage: 0, correctCount: 0, wrongCount: 1 })],
			new: []
		});
		vi.spyOn(QuizCardRepository, 'findQuizCardsByVocaIds').mockResolvedValue([makeQuizCard()]);
		vi.spyOn(QuizCardRepository, 'findNewQuizCandidates').mockResolvedValue([]);
		vi.spyOn(VocaRepository, 'findVocaByIds').mockResolvedValue([makeVoca()]);

		const result = await loadQuizPage(baseRequest.user);

		expect(result.encounters[0]).toMatchObject({ reviewStage: 0, isNew: false });
	});

	it('creates a review only when a new candidate is solved', async () => {
		vi.spyOn(ReviewRepository, 'findReviewByUserAndVoca').mockResolvedValue(null);

		await checkQuizAnswer({ ...baseRequest, answerText: 'apple' });

		expect(ReviewRepository.upsertReview).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'user-1',
				vocaId: 'voca-1',
				reviewStage: 4,
				correctCount: 1,
				wrongCount: 0
			})
		);
		expect(NewVocaLimitService.assertCanStartNewVoca).not.toHaveBeenCalled();
	});

	it('keeps the same stored-correct path after a wrong check', async () => {
		const currentReview = makeReview({
			reviewStage: 0,
			correctCount: 0,
			wrongCount: 0,
			exampleScoreById: {}
		});
		const nextReview = { ...currentReview, reviewStage: 5, correctCount: 1 };
		vi.spyOn(ReviewRepository, 'findReviewByUserAndVoca').mockResolvedValue(currentReview);
		vi.spyOn(AnswerMemoService, 'findCachedJudge').mockResolvedValue(makeAnswerMemo());
		vi.spyOn(ReviewUtil, 'applyCorrectToReview').mockReturnValue(nextReview);

		await checkQuizAnswer({
			...baseRequest,
			answerText: 'pear'
		});
		const result = await checkQuizAnswer({
			...baseRequest,
			answerText: 'APPLE'
		});

		expect(result.status).toBe('correct');
		expect(ReviewUtil.applyCorrectToReview).toHaveBeenCalledWith(
			currentReview,
			'example-1',
			expect.any(Date)
		);
		expect(ReviewRepository.upsertReview).toHaveBeenCalledTimes(1);
	});

	it('advances an existing review when corrected on retry', async () => {
		const currentReview = makeReview({ reviewStage: 5, correctCount: 2, wrongCount: 1 });
		vi.spyOn(ReviewRepository, 'findReviewByUserAndVoca').mockResolvedValue(currentReview);
		const result = await checkQuizAnswer({ ...baseRequest, answerText: 'apple', isRetry: true });
		expect(result).toMatchObject({ status: 'correct', reviewStage: 6 });
		expect(ReviewRepository.upsertReview).toHaveBeenCalledWith(
			expect.objectContaining({ reviewStage: 6, correctCount: 3, wrongCount: 1 })
		);
	});

	it('advances a new word when corrected on retry', async () => {
		vi.spyOn(ReviewRepository, 'findReviewByUserAndVoca').mockResolvedValue(null);
		const result = await checkQuizAnswer({ ...baseRequest, answerText: 'apple', isRetry: true });
		expect(result).toMatchObject({ status: 'correct', reviewStage: 4 });
		expect(ReviewRepository.upsertReview).toHaveBeenCalledWith(
			expect.objectContaining({ reviewStage: 4, correctCount: 1, wrongCount: 0 })
		);
	});

	it('records a manual pass after a wrong attempt', async () => {
		const result = await passQuizAnswer({ ...baseRequest, isRetry: true });
		expect(result).toMatchObject({ status: 'pass', reviewStage: 0 });
		expect(ReviewRepository.upsertReview).toHaveBeenCalledWith(
			expect.objectContaining({ reviewStage: 0, wrongCount: 1 })
		);
	});

	it('reuses cached judge results without calling AI again', async () => {
		vi.spyOn(AnswerMemoService, 'findCachedJudge').mockResolvedValue(
			makeAnswerMemo({
				reasonCode: AI_JUDGE_REASON_CODES.TENSE,
				hintText: 'tense mismatch',
				retryCount: 1
			})
		);
		const judgeAnswerSpy = vi.spyOn(AiJudgeService, 'judgeAnswer');
		const saveJudgeResultSpy = vi.spyOn(AnswerMemoService, 'saveJudgeResult');

		const result = await judgeQuizAnswer({
			...baseRequest,
			answerText: 'apples'
		});

		expect(result).toEqual({
			status: 'wrong',
			reasonCode: AI_JUDGE_REASON_CODES.TENSE,
			reasonLabel: AI_JUDGE_REASON_LABELS[AI_JUDGE_REASON_CODES.TENSE],
			hintText: 'tense mismatch',
			spellingDistance: 1,
			initialHint: 'a…',
			canJudge: false,
			canRegenerate: true
		});
		expect(judgeAnswerSpy).not.toHaveBeenCalled();
		expect(saveJudgeResultSpy).not.toHaveBeenCalled();
	});

	it('calls AI judge on cache miss and saves the new memo', async () => {
		vi.spyOn(AnswerMemoService, 'findCachedJudge').mockResolvedValue(null);
		vi.spyOn(AiJudgeService, 'judgeAnswer').mockResolvedValue({
			reasonCode: AI_JUDGE_REASON_CODES.TENSE,
			hintText: 'tense mismatch'
		});
		vi.spyOn(AnswerMemoService, 'saveJudgeResult').mockResolvedValue(
			makeAnswerMemo({
				normalizedAnswerText: 'apples',
				reasonCode: AI_JUDGE_REASON_CODES.TENSE,
				hintText: 'tense mismatch',
				retryCount: 1
			})
		);

		const result = await judgeQuizAnswer({
			...baseRequest,
			answerText: 'apples'
		});

		expect(AiJudgeService.judgeAnswer).toHaveBeenCalledOnce();
		expect(AnswerMemoService.saveJudgeResult).toHaveBeenCalledWith({
			vocaId: 'voca-1',
			quizExampleId: 'example-1',
			promptLang: 'ko',
			answerLang: 'en',
			normalizedAnswerText: 'apples',
			reasonCode: AI_JUDGE_REASON_CODES.TENSE,
			hintText: 'tense mismatch',
			retryCount: 1
		});
		expect(result.status).toBe('wrong');
		expect(result.canJudge).toBe(false);
		expect(result.canRegenerate).toBe(true);
	});

	it('regenerates a rejected AI explanation once and replaces the cached memo', async () => {
		const cachedMemo = makeAnswerMemo({
			reasonCode: AI_JUDGE_REASON_CODES.TENSE,
			hintText: 'previous explanation',
			retryCount: 1
		});
		vi.spyOn(AnswerMemoService, 'findCachedJudge').mockResolvedValue(cachedMemo);
		vi.spyOn(AiJudgeService, 'judgeAnswer').mockResolvedValue({
			reasonCode: AI_JUDGE_REASON_CODES.NUMBER,
			hintText: 'new explanation'
		});
		vi.spyOn(AnswerMemoService, 'saveJudgeResult').mockResolvedValue(
			makeAnswerMemo({
				reasonCode: AI_JUDGE_REASON_CODES.NUMBER,
				hintText: 'new explanation',
				retryCount: 2
			})
		);

		const result = await judgeQuizAnswer({
			...baseRequest,
			answerText: 'apples',
			regenerate: true
		});

		expect(AiJudgeService.judgeAnswer).toHaveBeenCalledWith(expect.any(Object), 'apple', 'apples', {
			reasonCode: AI_JUDGE_REASON_CODES.TENSE,
			hintText: 'previous explanation'
		});
		expect(AnswerMemoService.saveJudgeResult).toHaveBeenCalledWith({
			vocaId: 'voca-1',
			quizExampleId: 'example-1',
			promptLang: 'ko',
			answerLang: 'en',
			normalizedAnswerText: 'apples',
			reasonCode: AI_JUDGE_REASON_CODES.NUMBER,
			hintText: 'new explanation',
			retryCount: 2
		});
		expect(result.canJudge).toBe(false);
		expect(result.canRegenerate).toBe(false);
	});

	it('persists pass results immediately', async () => {
		const nextReview = { ...makeReview(), reviewStage: 0, wrongCount: 1 };
		vi.spyOn(ReviewUtil, 'applyPassToReview').mockReturnValue(nextReview);

		const result = await passQuizAnswer(baseRequest);

		expect(result.status).toBe('pass');
		expect(ReviewUtil.applyPassToReview).toHaveBeenCalledOnce();
		expect(ReviewRepository.upsertReview).toHaveBeenCalledOnce();
		expect(UserService.saveUser).not.toHaveBeenCalled();
		expect(VocaRepository.updateVocaDifficultyIfCurrent).toHaveBeenCalledWith('voca-1', 3, 3.28);
	});

	it('does not adjust difficulty again after the first review result', async () => {
		const currentReview = makeReview({ correctCount: 1, wrongCount: 0 });
		const nextReview = makeReview({ correctCount: 2, wrongCount: 0 });
		vi.spyOn(ReviewRepository, 'findReviewByUserAndVoca').mockResolvedValue(currentReview);
		vi.spyOn(ReviewUtil, 'applyCorrectToReview').mockReturnValue(nextReview);

		await checkQuizAnswer({ ...baseRequest, answerText: 'apple' });

		expect(ReviewRepository.countAnsweredReviewsByVoca).not.toHaveBeenCalled();
		expect(VocaRepository.updateVocaDifficultyIfCurrent).not.toHaveBeenCalled();
	});

	it('recalculates and saves vocabulary level after a solved quiz', async () => {
		const currentUser = makeUser({ currentLevel: 1 });
		const nextUser = makeUser({ currentLevel: 3.42 });
		const answeredReview = makeReview({ reviewStage: 4, correctCount: 1, wrongCount: 0 });
		vi.spyOn(ReviewRepository, 'findRecentDistinctAnsweredReviews').mockResolvedValue([
			answeredReview
		]);
		vi.spyOn(UserService, 'rebuildUserLevel').mockReturnValue(nextUser);

		await checkQuizAnswer({ ...baseRequest, user: currentUser, answerText: 'apple' });

		expect(ReviewRepository.findRecentDistinctAnsweredReviews).toHaveBeenCalledWith('user-1', 500);
		expect(VocaRepository.findVocaDifficultiesByIds).toHaveBeenCalledWith(['voca-1']);
		expect(UserService.saveUser).toHaveBeenCalledWith(nextUser);
	});
});
