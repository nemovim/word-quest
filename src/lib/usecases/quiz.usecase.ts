import type { AnswerMemo } from '$lib/shared/types/answer-memo.type';
import type { QuizCard, QuizExample } from '$lib/shared/types/quiz-card.type';
import type { QuizEncounter, QuizPageData } from '$lib/shared/types/quiz.type';
import type { Review, ReviewCreate } from '$lib/shared/types/review.type';
import type { User } from '$lib/shared/types/user.type';
import type { Voca } from '$lib/shared/types/voca.type';

import {
	findNewQuizCandidates,
	findQuizCardByVocaId,
	findQuizCardsByVocaIds
} from '$lib/repositories/quiz-card.repository';
import { findPendingReportedVocaIds } from '$lib/repositories/quiz-report.repository';
import {
	countAnsweredReviewsByVoca,
	countDistinctAnsweredVocasByUser,
	findDueReviewGroupsByUser,
	findRecentDistinctAnsweredReviews,
	findReviewByUserAndVoca,
	findReviewedVocaIdsByUserDirection,
	upsertReview
} from '$lib/repositories/review.repository';
import {
	findPermanentlyExcludedVocaIds,
	findVocaByIds,
	getVocaById,
	updateVocaDifficultyIfCurrent
} from '$lib/repositories/voca.repository';
import { judgeAnswer } from '$lib/service/ai-judge.service';
import { findCachedJudge, saveJudgeResult } from '$lib/service/answer-memo.service';
import { rebuildUserLevel, saveUser } from '$lib/service/user.service';
import { calculateAdjustedDifficulty } from '$lib/service/voca.service';
import {
	DEFAULT_QUIZ_SESSION_SIZE,
	KOREAN_LANGUAGE_CODE,
	LANGUAGE_CODES,
	QUIZ_DIRECTION_MODES,
	type LanguageCode,
	type QuizDirectionMode
} from '$lib/shared/types/general.type';
import {
	getAnswerInitialHint,
	getCloseAnswerDistance,
	getAnswerWordCount,
	normalizeAnswer
} from '$lib/shared/utils/answer.util';
import {
	getAiJudgeReasonLabel,
	QUIZ_FEEDBACK_HINTS,
	QUIZ_FEEDBACK_REASONS
} from '$lib/shared/utils/quiz-feedback.util';
import { pickWeightedQuizExample } from '$lib/shared/utils/quiz.util';
import {
	applyCorrectToReview,
	applyPassToReview,
	getReviewStageLabel,
	isFirstReviewResult,
	normalizeReviewStage
} from '$lib/shared/utils/review.util';

type QuizTarget = {
	vocaId: string;
	quizExampleId: string;
	promptLang: LanguageCode;
	answerLang: LanguageCode;
};

type QuizBaseRequest = QuizTarget & {
	user: User;
	isRetry?: boolean;
};

type QuizWrongFeedback = {
	status: 'wrong';
	reasonCode: AnswerMemo['reasonCode'] | null;
	reasonLabel: string | null;
	hintText: string | null;
	initialHint: string;
	spellingDistance: number | null;
	canJudge: boolean;
	canRegenerate: boolean;
};

type QuizSolvedFeedback = {
	status: 'correct' | 'pass';
	reasonLabel: string;
	hintText: string;
	correctAnswer: string;
	pronunciationText: string;
	reviewStage: number;
	nextReviewLabel: string;
};

type QuizExampleText = {
	sentenceTemplate: string;
	fillText: string;
	pronunciationText: string;
};

type QuizJudgePrompt = Pick<
	QuizEncounter,
	'answerLang' | 'answerTemplate' | 'promptTemplate' | 'promptFillText'
>;

const DIFFICULTY_UPDATE_RETRY_LIMIT = 3;
const QUIZ_LEVEL_EVIDENCE_LIMIT = 500;

function parseLanguageCode(value: string | undefined): LanguageCode {
	if (value == null || !Object.values(LANGUAGE_CODES).includes(value as LanguageCode)) {
		throw new Error(`Invalid language code: ${value ?? ''}`);
	}

	return value as LanguageCode;
}

export function parseDirectionMode(value: string | null | undefined): QuizDirectionMode {
	return value === QUIZ_DIRECTION_MODES.TARGET_TO_KO
		? QUIZ_DIRECTION_MODES.TARGET_TO_KO
		: QUIZ_DIRECTION_MODES.KO_TO_TARGET;
}

export function parseQuizTarget(payload: {
	vocaId?: string;
	quizExampleId?: string;
	promptLang?: string;
	answerLang?: string;
}): QuizTarget {
	if (
		payload.vocaId == null ||
		payload.quizExampleId == null ||
		payload.promptLang == null ||
		payload.answerLang == null
	) {
		throw new Error('Invalid quiz request.');
	}

	return {
		vocaId: payload.vocaId,
		quizExampleId: payload.quizExampleId,
		promptLang: parseLanguageCode(payload.promptLang),
		answerLang: parseLanguageCode(payload.answerLang)
	};
}

function getDirectionPair(
	currentVoca: Voca,
	directionMode: QuizDirectionMode
): Pick<Review, 'promptLang' | 'answerLang'> {
	return directionMode === QUIZ_DIRECTION_MODES.TARGET_TO_KO
		? {
				promptLang: currentVoca.targetLang,
				answerLang: KOREAN_LANGUAGE_CODE
			}
		: {
				promptLang: KOREAN_LANGUAGE_CODE,
				answerLang: currentVoca.targetLang
			};
}

function getQuizExampleText(
	currentExample: QuizExample,
	languageCode: LanguageCode
): QuizExampleText {
	if (languageCode === KOREAN_LANGUAGE_CODE) {
		return {
			sentenceTemplate: currentExample.sourceSentenceTemplate,
			fillText: currentExample.sourceFillText,
			pronunciationText: currentExample.sourceFillText
		};
	}

	return {
		sentenceTemplate: currentExample.targetSentenceTemplate,
		fillText: currentExample.targetFillText,
		pronunciationText: currentExample.targetPronunciationText
	};
}

function assertDirectionPair(
	currentVoca: Voca,
	promptLang: LanguageCode,
	answerLang: LanguageCode
): void {
	if (promptLang === answerLang) {
		throw new Error('Prompt and answer languages must be different.');
	}

	const supportedLanguages = new Set([KOREAN_LANGUAGE_CODE, currentVoca.targetLang]);

	if (!supportedLanguages.has(promptLang) || !supportedLanguages.has(answerLang)) {
		throw new Error('Unsupported quiz direction for this voca.');
	}
}

function buildEncounter(
	currentReview: Pick<Review, 'reviewStage' | 'correctCount' | 'wrongCount'>,
	currentVoca: Voca,
	currentExample: QuizExample,
	promptLang: LanguageCode,
	answerLang: LanguageCode
): QuizEncounter {
	assertDirectionPair(currentVoca, promptLang, answerLang);
	const promptText = getQuizExampleText(currentExample, promptLang);
	const answerText = getQuizExampleText(currentExample, answerLang);

	if (currentVoca.difficultyLevel == null || currentVoca.utilityScore == null) {
		throw new Error('The voca has not been initialized by ai yet.');
	}

	return {
		vocaId: currentVoca._id,
		difficultyLevel: currentVoca.difficultyLevel,
		utilityScore: currentVoca.utilityScore,
		partOfSpeech: currentVoca.partOfSpeech,
		quizExampleId: currentExample._id,
		promptLang,
		answerLang,
		promptTemplate: promptText.sentenceTemplate,
		promptFillText: promptText.fillText,
		answerTemplate: answerText.sentenceTemplate,
		answerWordCount: getAnswerWordCount(answerText.fillText),
		pronunciationText: answerText.pronunciationText,
		reviewStage: normalizeReviewStage(currentReview.reviewStage),
		isNew: isFirstReviewResult(currentReview)
	};
}

function getQuizExample(currentQuizCard: QuizCard, quizExampleId: string): QuizExample {
	const currentExample = currentQuizCard.examples.find((example) => example._id === quizExampleId);

	if (currentExample == null) {
		throw new Error(`Quiz example not found: ${quizExampleId}`);
	}

	return currentExample;
}

function buildWrongFeedback(
	currentMemo: AnswerMemo | null,
	canJudge: boolean,
	correctAnswerText: string,
	answerText: string,
	answerLang: LanguageCode
): QuizWrongFeedback {
	return {
		status: 'wrong',
		spellingDistance: getCloseAnswerDistance(answerText, correctAnswerText, answerLang),
		reasonCode: currentMemo?.reasonCode ?? null,
		reasonLabel: getAiJudgeReasonLabel(currentMemo?.reasonCode ?? null),
		hintText: currentMemo?.hintText ?? null,
		initialHint: getAnswerInitialHint(correctAnswerText),
		canJudge,
		canRegenerate: currentMemo != null && currentMemo.retryCount === 1
	};
}

function buildSolvedFeedback(
	status: 'correct' | 'pass',
	currentEncounter: QuizEncounter,
	nextReview: Review,
	correctAnswer: string
): QuizSolvedFeedback {
	return {
		status,
		reasonLabel: status === 'correct' ? QUIZ_FEEDBACK_REASONS.CORRECT : QUIZ_FEEDBACK_REASONS.PASS,
		hintText: status === 'correct' ? QUIZ_FEEDBACK_HINTS.CORRECT : QUIZ_FEEDBACK_HINTS.PASS,
		correctAnswer,
		pronunciationText: currentEncounter.pronunciationText,
		reviewStage: nextReview.reviewStage,
		nextReviewLabel: getReviewStageLabel(nextReview.reviewStage)
	};
}

async function refreshUserLevel(currentUser: User, now: Date): Promise<User> {
	const levelReviews = await findRecentDistinctAnsweredReviews(currentUser._id, 500);
	const levelVocaIds = levelReviews.map((currentReview) => currentReview.vocaId);
	const levelVocas = levelVocaIds.length === 0 ? [] : await findVocaByIds(levelVocaIds);
	const nextUser = rebuildUserLevel(currentUser, levelReviews, levelVocas, now);

	return nextUser === currentUser ? currentUser : await saveUser(nextUser);
}

async function loadQuizTargetContext(request: QuizTarget) {
	const [currentVoca, currentQuizCard] = await Promise.all([
		getVocaById(request.vocaId),
		findQuizCardByVocaId(request.vocaId)
	]);

	if (currentQuizCard == null) {
		throw new Error(`Quiz card not found for voca: ${request.vocaId}`);
	}

	const currentExample = getQuizExample(currentQuizCard, request.quizExampleId);
	assertDirectionPair(currentVoca, request.promptLang, request.answerLang);
	const promptText = getQuizExampleText(currentExample, request.promptLang);
	const answerText = getQuizExampleText(currentExample, request.answerLang);

	return {
		currentVoca,
		currentExample,
		correctAnswerText: answerText.fillText,
		judgePrompt: {
			answerLang: request.answerLang,
			answerTemplate: answerText.sentenceTemplate,
			promptTemplate: promptText.sentenceTemplate,
			promptFillText: promptText.fillText
		} satisfies QuizJudgePrompt
	};
}

async function loadQuizReviewContext(
	request: QuizBaseRequest,
	currentVoca: Voca,
	currentExample: QuizExample
) {
	const currentReview = await findReviewByUserAndVoca(
		request.user._id,
		request.vocaId,
		request.promptLang,
		request.answerLang
	);
	const now = new Date();
	const reviewForEncounter =
		currentReview ??
		({
			userId: request.user._id,
			vocaId: request.vocaId,
			promptLang: request.promptLang,
			answerLang: request.answerLang,
			reviewStage: 0,
			dueAt: now.toISOString(),
			lastReviewedAt: now.toISOString(),
			correctCount: 0,
			wrongCount: 0,
			exampleScoreById: {}
		} satisfies ReviewCreate);

	return {
		currentReview: reviewForEncounter,
		currentEncounter: buildEncounter(
			reviewForEncounter,
			currentVoca,
			currentExample,
			request.promptLang,
			request.answerLang
		)
	};
}

async function adjustDifficultyAfterFirstResult(
	currentVoca: Voca,
	request: QuizBaseRequest,
	isCorrect: boolean
): Promise<void> {
	if (
		currentVoca.difficultyLevel == null ||
		request.promptLang !== KOREAN_LANGUAGE_CODE ||
		request.answerLang !== currentVoca.targetLang
	) {
		return;
	}

	try {
		const answeredReviewCount = await countAnsweredReviewsByVoca(
			currentVoca._id,
			KOREAN_LANGUAGE_CODE,
			currentVoca.targetLang
		);
		const previousSampleCount = Math.max(0, answeredReviewCount - 1);
		let expectedVoca = currentVoca;

		for (let attempt = 0; attempt < DIFFICULTY_UPDATE_RETRY_LIMIT; attempt += 1) {
			if (expectedVoca.difficultyLevel == null) {
				return;
			}

			const nextDifficultyLevel = calculateAdjustedDifficulty(
				expectedVoca.difficultyLevel,
				request.user.currentLevel,
				isCorrect,
				previousSampleCount
			);

			if (nextDifficultyLevel === expectedVoca.difficultyLevel) {
				return;
			}

			const updatedVoca = await updateVocaDifficultyIfCurrent(
				expectedVoca._id,
				expectedVoca.difficultyLevel,
				nextDifficultyLevel
			);

			if (updatedVoca != null) {
				return;
			}

			expectedVoca = await getVocaById(expectedVoca._id);
		}
	} catch (error) {
		console.error('Failed to adjust voca difficulty.', error);
	}
}

export async function loadQuizPage(
	currentUser: User,
	directionMode: QuizDirectionMode = QUIZ_DIRECTION_MODES.KO_TO_TARGET
): Promise<QuizPageData> {
	const now = new Date();
	const directionField =
		directionMode === QUIZ_DIRECTION_MODES.TARGET_TO_KO ? 'answerLang' : 'promptLang';
	const [levelEvidenceCount, reviewedVocaIds, pendingReportedVocaIds, permanentlyExcludedVocaIds] =
		await Promise.all([
			countDistinctAnsweredVocasByUser(currentUser._id, QUIZ_LEVEL_EVIDENCE_LIMIT),
			findReviewedVocaIdsByUserDirection(currentUser._id, directionField, KOREAN_LANGUAGE_CODE),
			findPendingReportedVocaIds(),
			findPermanentlyExcludedVocaIds()
		]);
	const unavailableVocaIds = [...pendingReportedVocaIds, ...permanentlyExcludedVocaIds];
	const dueReviewGroups = await findDueReviewGroupsByUser(
		currentUser._id,
		directionField,
		KOREAN_LANGUAGE_CODE,
		now,
		DEFAULT_QUIZ_SESSION_SIZE,
		unavailableVocaIds
	);
	const reviewed = dueReviewGroups.reviewed.slice(0, DEFAULT_QUIZ_SESSION_SIZE);
	const queuedNew = dueReviewGroups.new.slice(0, DEFAULT_QUIZ_SESSION_SIZE - reviewed.length);
	const availableReviews = [...reviewed, ...queuedNew];
	const dueVocaIds = Array.from(new Set(availableReviews.map((reviewItem) => reviewItem.vocaId)));
	const excludedVocaIds = Array.from(new Set([...reviewedVocaIds, ...unavailableVocaIds]));
	const [dueQuizCards, dueVocas, candidates] = await Promise.all([
		dueVocaIds.length === 0 ? [] : findQuizCardsByVocaIds(dueVocaIds),
		dueVocaIds.length === 0 ? [] : findVocaByIds(dueVocaIds),
		findNewQuizCandidates({
			currentLevel: currentUser.currentLevel,
			evidenceCount: levelEvidenceCount,
			excludedVocaIds,
			limit: DEFAULT_QUIZ_SESSION_SIZE - availableReviews.length
		})
	]);
	const quizCardMap = new Map(dueQuizCards.map((quizCard) => [quizCard.vocaId, quizCard]));
	const vocaMap = new Map(dueVocas.map((voca) => [voca._id, voca]));

	for (const candidate of candidates) {
		quizCardMap.set(candidate.voca._id, candidate.quizCard);
		vocaMap.set(candidate.voca._id, candidate.voca);
	}

	const encounters: QuizEncounter[] = [];
	let lastQuizExampleId: string | undefined;

	for (const currentReview of availableReviews) {
		const currentQuizCard = quizCardMap.get(currentReview.vocaId);

		if (currentQuizCard == null || currentQuizCard.examples.length === 0) {
			continue;
		}

		const currentVoca = vocaMap.get(currentReview.vocaId);

		if (currentVoca == null) {
			continue;
		}

		const currentExample = pickWeightedQuizExample(
			currentQuizCard.examples,
			currentReview.exampleScoreById,
			lastQuizExampleId
		);
		const encounter = buildEncounter(
			currentReview,
			currentVoca,
			currentExample,
			currentReview.promptLang,
			currentReview.answerLang
		);
		encounters.push(encounter);
		lastQuizExampleId = encounter.quizExampleId;
	}

	for (const candidate of candidates) {
		const directionPair = getDirectionPair(candidate.voca, directionMode);
		const currentExample = pickWeightedQuizExample(
			candidate.quizCard.examples,
			{},
			lastQuizExampleId
		);
		const encounter = buildEncounter(
			{ reviewStage: 0, correctCount: 0, wrongCount: 0 },
			candidate.voca,
			currentExample,
			directionPair.promptLang,
			directionPair.answerLang
		);

		encounters.push(encounter);
		lastQuizExampleId = encounter.quizExampleId;
	}

	return {
		directionMode,
		encounters,
		isEmpty: encounters.length === 0,
		emptyReason: encounters.length > 0 ? null : 'no-quiz'
	};
}

function toReviewCreate(currentReview: Review | ReviewCreate): ReviewCreate {
	return {
		userId: currentReview.userId,
		vocaId: currentReview.vocaId,
		promptLang: currentReview.promptLang,
		answerLang: currentReview.answerLang,
		reviewStage: currentReview.reviewStage,
		dueAt: currentReview.dueAt,
		lastReviewedAt: currentReview.lastReviewedAt,
		correctCount: currentReview.correctCount,
		wrongCount: currentReview.wrongCount,
		exampleScoreById: currentReview.exampleScoreById
	};
}

async function recordQuizResult(
	request: QuizBaseRequest,
	result: 'correct' | 'pass',
	currentVoca: Voca,
	currentExample: QuizExample,
	correctAnswerText: string,
	now: Date
): Promise<QuizSolvedFeedback> {
	const unavailableVocaIds = await Promise.all([
		findPendingReportedVocaIds(),
		findPermanentlyExcludedVocaIds()
	]);
	if (unavailableVocaIds.some((vocaIds) => vocaIds.includes(request.vocaId))) {
		throw new Error('신고 처리 중이거나 퀴즈에서 제외된 단어는 학습 기록에 저장할 수 없습니다.');
	}

	const { currentReview, currentEncounter } = await loadQuizReviewContext(
		request,
		currentVoca,
		currentExample
	);
	const isFirstResult = isFirstReviewResult(currentReview);

	if (result === 'pass' && request.isRetry) {
		return buildSolvedFeedback(
			result,
			currentEncounter,
			currentReview as Review,
			correctAnswerText
		);
	}

	const nextReview =
		result === 'pass'
			? applyPassToReview(currentReview as Review, currentExample._id, now)
			: request.isRetry === true
				? applyCorrectToReview(currentReview as Review, currentExample._id, now, {
						isRetry: true
					})
				: applyCorrectToReview(currentReview as Review, currentExample._id, now);
	const savedReview = await upsertReview(toReviewCreate(nextReview));

	if (isFirstResult) {
		await adjustDifficultyAfterFirstResult(currentVoca, request, result === 'correct');
	}

	await refreshUserLevel(request.user, now);

	return buildSolvedFeedback(result, currentEncounter, savedReview, correctAnswerText);
}

export async function checkQuizAnswer(request: {
	user: User;
	vocaId: string;
	quizExampleId: string;
	promptLang: LanguageCode;
	answerLang: LanguageCode;
	answerText: string;
	isRetry?: boolean;
}) {
	const now = new Date();
	const { currentVoca, currentExample, correctAnswerText } = await loadQuizTargetContext(request);
	const normalizedAnswerText = normalizeAnswer(request.answerText, request.answerLang);
	const normalizedTargetText = normalizeAnswer(correctAnswerText, request.answerLang);

	if (normalizedAnswerText === normalizedTargetText) {
		return recordQuizResult(
			request,
			'correct',
			currentVoca,
			currentExample,
			correctAnswerText,
			now
		);
	}

	if (!request.isRetry) {
		await recordQuizResult(request, 'pass', currentVoca, currentExample, correctAnswerText, now);
	}
	const currentMemo = await findCachedJudge(
		currentExample._id,
		request.promptLang,
		request.answerLang,
		normalizedAnswerText
	);

	return buildWrongFeedback(
		currentMemo,
		currentMemo == null || currentMemo.retryCount < 1,
		correctAnswerText,
		request.answerText,
		request.answerLang
	);
}

export async function revealQuizAnswer(request: QuizTarget) {
	const { currentExample, correctAnswerText } = await loadQuizTargetContext(request);
	return {
		correctAnswer: correctAnswerText,
		pronunciationText: getQuizExampleText(currentExample, request.answerLang).pronunciationText
	};
}

export async function passQuizAnswer(request: {
	user: User;
	isRetry?: boolean;
	vocaId: string;
	quizExampleId: string;
	promptLang: LanguageCode;
	answerLang: LanguageCode;
}) {
	const now = new Date();
	const { currentVoca, currentExample, correctAnswerText } = await loadQuizTargetContext(request);
	return recordQuizResult(request, 'pass', currentVoca, currentExample, correctAnswerText, now);
}

export async function judgeQuizAnswer(request: {
	vocaId: string;
	quizExampleId: string;
	promptLang: LanguageCode;
	answerLang: LanguageCode;
	answerText: string;
	regenerate?: boolean;
}) {
	const { currentExample, correctAnswerText, judgePrompt } = await loadQuizTargetContext(request);
	const normalizedAnswerText = normalizeAnswer(request.answerText, request.answerLang);
	const cachedMemo = await findCachedJudge(
		currentExample._id,
		request.promptLang,
		request.answerLang,
		normalizedAnswerText
	);

	if (
		cachedMemo != null &&
		(cachedMemo.retryCount >= 2 || (!request.regenerate && cachedMemo.retryCount >= 1))
	) {
		return buildWrongFeedback(
			cachedMemo,
			false,
			correctAnswerText,
			request.answerText,
			request.answerLang
		);
	}

	const judgedResult = await judgeAnswer(
		judgePrompt,
		correctAnswerText,
		request.answerText,
		cachedMemo == null
			? undefined
			: { reasonCode: cachedMemo.reasonCode, hintText: cachedMemo.hintText }
	);
	const savedMemo = await saveJudgeResult({
		vocaId: request.vocaId,
		quizExampleId: currentExample._id,
		promptLang: request.promptLang,
		answerLang: request.answerLang,
		normalizedAnswerText,
		...judgedResult,
		retryCount: (cachedMemo?.retryCount ?? 0) + 1
	});

	return buildWrongFeedback(
		savedMemo,
		false,
		correctAnswerText,
		request.answerText,
		request.answerLang
	);
}
