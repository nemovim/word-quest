import type { Review } from '$lib/shared/types/review.type';

import {
	EXAMPLE_SCORE_MAX,
	LONG_TERM_REVIEW_STAGE,
	MAX_REVIEW_STAGE,
	REVIEW_STAGE_DELAYS,
	REVIEW_STAGE_LABELS
} from '$lib/shared/types/general.type';
import { clampNumber } from '$lib/shared/utils/general.util';

const FIRST_CORRECT_REVIEW_STAGE = 4;
const WRONG_REVIEW_STAGE_PENALTY = 2;

export function normalizeReviewStage(reviewStage: number): number {
	return Math.trunc(clampNumber(reviewStage, 0, MAX_REVIEW_STAGE));
}

export function getReviewStageLabel(reviewStage: number): string {
	return REVIEW_STAGE_LABELS[normalizeReviewStage(reviewStage) as keyof typeof REVIEW_STAGE_LABELS];
}

export function getNextDueAt(reviewStage: number, now: Date): string {
	const seconds =
		REVIEW_STAGE_DELAYS[normalizeReviewStage(reviewStage) as keyof typeof REVIEW_STAGE_DELAYS] ?? 0;

	return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function isDueReview(reviewItem: Review, now: Date): boolean {
	return new Date(reviewItem.dueAt).getTime() <= now.getTime();
}

export function isFirstReviewResult(
	currentReview: Pick<Review, 'correctCount' | 'wrongCount'>
): boolean {
	return currentReview.correctCount === 0 && currentReview.wrongCount === 0;
}

export function isLongTermStage(reviewStage: number): boolean {
	return normalizeReviewStage(reviewStage) >= LONG_TERM_REVIEW_STAGE;
}

export function getNextCorrectStage(currentStage: number, isFirstResult: boolean): number {
	if (isFirstResult) {
		return FIRST_CORRECT_REVIEW_STAGE;
	}

	return clampNumber(normalizeReviewStage(currentStage) + 1, 0, MAX_REVIEW_STAGE);
}

export function getNextWrongStage(currentStage: number): number {
	const normalizedCurrentStage = normalizeReviewStage(currentStage);
	return clampNumber(normalizedCurrentStage - WRONG_REVIEW_STAGE_PENALTY, 0, MAX_REVIEW_STAGE);
}

export function getUpdatedExampleScore(currentScore: number | undefined, isPass: boolean): number {
	const score = currentScore ?? 0;

	if (isPass) {
		return clampNumber(score + 2, 0, EXAMPLE_SCORE_MAX);
	}

	return clampNumber(score - 1, 0, EXAMPLE_SCORE_MAX);
}

export function applyCorrectToReview(
	currentReview: Review,
	quizExampleId: string,
	now: Date,
	options: { isRetry?: boolean } = {}
): Review {
	const nextStage =
		options.isRetry === true
			? normalizeReviewStage(currentReview.reviewStage)
			: getNextCorrectStage(currentReview.reviewStage, isFirstReviewResult(currentReview));
	const nextExampleScoreById = { ...currentReview.exampleScoreById };
	nextExampleScoreById[quizExampleId] = getUpdatedExampleScore(
		nextExampleScoreById[quizExampleId],
		false
	);

	return {
		...currentReview,
		reviewStage: nextStage,
		dueAt: getNextDueAt(nextStage, now),
		lastReviewedAt: now.toISOString(),
		correctCount: currentReview.correctCount + 1,
		exampleScoreById: nextExampleScoreById
	};
}

export function applyPassToReview(currentReview: Review, quizExampleId: string, now: Date): Review {
	const nextStage = getNextWrongStage(currentReview.reviewStage);
	const nextExampleScoreById = { ...currentReview.exampleScoreById };
	nextExampleScoreById[quizExampleId] = getUpdatedExampleScore(
		nextExampleScoreById[quizExampleId],
		true
	);

	return {
		...currentReview,
		reviewStage: nextStage,
		dueAt: getNextDueAt(nextStage, now),
		lastReviewedAt: now.toISOString(),
		wrongCount: currentReview.wrongCount + 1,
		exampleScoreById: nextExampleScoreById
	};
}
