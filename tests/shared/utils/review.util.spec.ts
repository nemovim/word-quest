import { describe, expect, it } from 'vitest';

import type { Review } from '$lib/shared/types/review.type';

import { LANGUAGE_CODES } from '$lib/shared/types/general.type';
import {
	applyCorrectToReview,
	applyPassToReview,
	getNextWrongStage,
	getUpdatedExampleScore,
	isDueReview,
	isFirstReviewResult,
	isLongTermStage,
	normalizeReviewStage
} from '$lib/shared/utils/review.util';

function makeReview(overrides: Partial<Review> = {}): Review {
	return {
		_id: 'review-1',
		userId: 'user-1',
		vocaId: 'voca-1',
		promptLang: LANGUAGE_CODES.KO,
		answerLang: LANGUAGE_CODES.EN,
		reviewStage: 2,
		dueAt: '2026-06-20T00:00:00.000Z',
		lastReviewedAt: '2026-06-20T00:00:00.000Z',
		correctCount: 3,
		wrongCount: 1,
		exampleScoreById: { 'example-1': 1 },
		createdAt: '2026-06-20T00:00:00.000Z',
		updatedAt: '2026-06-20T00:00:00.000Z',
		...overrides
	};
}

describe('review.util', () => {
	it('schedules a one-week confirmation after the first stored correct result', () => {
		const now = new Date('2026-06-21T10:00:00.000Z');
		const nextReview = applyCorrectToReview(
			makeReview({
				reviewStage: 0,
				correctCount: 0,
				wrongCount: 0,
				exampleScoreById: {}
			}),
			'example-1',
			now
		);

		expect(isFirstReviewResult(makeReview({ correctCount: 0, wrongCount: 0 }))).toBe(true);
		expect(nextReview.reviewStage).toBe(4);
		expect(isLongTermStage(nextReview.reviewStage)).toBe(false);
		expect(nextReview.correctCount).toBe(1);
	});

	it('reduces example score on correct and advances stage during memorization', () => {
		const now = new Date('2026-06-21T10:00:00.000Z');
		const nextReview = applyCorrectToReview(makeReview(), 'example-1', now);

		expect(nextReview.reviewStage).toBe(3);
		expect(nextReview.correctCount).toBe(4);
		expect(nextReview.exampleScoreById['example-1']).toBe(0);
		expect(nextReview.lastReviewedAt).toBe(now.toISOString());
	});

	it('uses the same score rule for every correct result', () => {
		const nextReview = applyCorrectToReview(
			makeReview({ exampleScoreById: { 'example-1': 2 } }),
			'example-1',
			new Date('2026-06-21T10:00:00.000Z')
		);

		expect(nextReview.exampleScoreById['example-1']).toBe(1);
	});

	it('keeps a positive current stage for a corrected retry', () => {
		const now = new Date('2026-06-21T10:00:00.000Z');
		const nextReview = applyCorrectToReview(makeReview({ reviewStage: 5 }), 'example-1', now, {
			isRetry: true
		});

		expect(nextReview.reviewStage).toBe(5);
		expect(nextReview.dueAt).toBe('2026-07-12T10:00:00.000Z');
		expect(nextReview.correctCount).toBe(4);
	});

	it('keeps a corrected wrong answer scheduled in one minute', () => {
		const now = new Date('2026-06-21T10:00:00.000Z');
		const nextReview = applyCorrectToReview(
			makeReview({ reviewStage: 0, correctCount: 2, wrongCount: 2 }),
			'example-1',
			now,
			{ isRetry: true }
		);

		expect(nextReview.reviewStage).toBe(0);
		expect(nextReview.dueAt).toBe('2026-06-21T10:01:00.000Z');
	});

	it('keeps the maximum stage and schedules another yearly review after a correct result', () => {
		const now = new Date('2026-06-21T10:00:00.000Z');
		const nextReview = applyCorrectToReview(makeReview({ reviewStage: 7 }), 'example-1', now);

		expect(nextReview.reviewStage).toBe(7);
		expect(nextReview.dueAt).toBe('2027-06-21T10:00:00.000Z');
	});

	it('drops two stages on pass and schedules from the lower stage', () => {
		const now = new Date('2026-06-21T10:00:00.000Z');
		const nextReview = applyPassToReview(makeReview({ reviewStage: 5 }), 'example-1', now);

		expect(nextReview.reviewStage).toBe(3);
		expect(nextReview.wrongCount).toBe(2);
		expect(nextReview.exampleScoreById['example-1']).toBe(3);
		expect(nextReview.dueAt).toBe('2026-06-24T10:00:00.000Z');
	});

	it('does not drop below stage zero on pass', () => {
		expect(getNextWrongStage(1)).toBe(0);
		expect(getNextWrongStage(0)).toBe(0);
	});

	it('normalizes a legacy stage 8 before applying the pass penalty', () => {
		expect(normalizeReviewStage(8)).toBe(7);
		expect(getNextWrongStage(8)).toBe(5);
	});

	it('caps example score updates inside the allowed range', () => {
		expect(getUpdatedExampleScore(0, false)).toBe(0);
		expect(getUpdatedExampleScore(5, true)).toBe(5);
	});

	it('checks due review status through a shared helper', () => {
		expect(isDueReview(makeReview(), new Date('2026-06-21T00:00:00.000Z'))).toBe(true);
		expect(
			isDueReview(
				makeReview({ dueAt: '2026-06-22T00:00:00.000Z' }),
				new Date('2026-06-21T00:00:00.000Z')
			)
		).toBe(false);
	});
});
