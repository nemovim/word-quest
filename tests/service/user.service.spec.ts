import { describe, expect, it } from 'vitest';

import { makeReview, makeUser, makeVoca } from '../helpers/factories';

import {
	calculateVocabularyLevel,
	rebuildUserLevel,
	selectRecentLevelReviews
} from '$lib/service/user.service';

describe('user.service', () => {
	it('keeps level 1 when there are no answered vocas', () => {
		const reviews = [makeReview({ correctCount: 0, wrongCount: 0 })];

		expect(calculateVocabularyLevel(reviews, [makeVoca()])).toBe(1);
	});

	it('allows poor results to lower the vocabulary level below 1, down to 0', () => {
		const reviews = Array.from({ length: 50 }, (_, index) =>
			makeReview({ vocaId: `voca-${index}`, reviewStage: 0, correctCount: 0, wrongCount: 1 })
		);
		const vocas = reviews.map((review) => makeVoca({ _id: review.vocaId, difficultyLevel: 1 }));

		expect(calculateVocabularyLevel(reviews.slice(0, 1), vocas)).toBeLessThan(1);
		expect(calculateVocabularyLevel(reviews, vocas)).toBe(0);
	});

	it('returns a continuous level and rewards mastery of harder vocas', () => {
		const masteredReview = makeReview({ reviewStage: 6, correctCount: 3, wrongCount: 0 });
		const easyLevel = calculateVocabularyLevel(
			[masteredReview],
			[makeVoca({ difficultyLevel: 2 })]
		);
		const hardLevel = calculateVocabularyLevel(
			[masteredReview],
			[makeVoca({ difficultyLevel: 7 })]
		);

		expect(easyLevel).toBeGreaterThan(1);
		expect(hardLevel).toBeGreaterThan(easyLevel);
		expect(Number.isInteger(hardLevel)).toBe(false);
	});

	it('uses the requested mastery values for each review stage', () => {
		const vocas = [makeVoca({ difficultyLevel: 1 })];
		const levels = Array.from({ length: 8 }, (_, stage) =>
			calculateVocabularyLevel(
				[makeReview({ reviewStage: stage, correctCount: 1, wrongCount: 0 })],
				vocas
			)
		);
		expect(levels[4]).toBe(1);
		for (let stage = 1; stage < levels.length; stage += 1)
			expect(levels[stage]).toBeGreaterThan(levels[stage - 1]);
		expect(
			calculateVocabularyLevel(
				[makeReview({ reviewStage: 8, correctCount: 1, wrongCount: 0 })],
				vocas
			)
		).toBe(levels[7]);
	});

	it('raises the level when first-correct reviews include harder words', () => {
		const reviews = Array.from({ length: 9 }, (_, index) =>
			makeReview({ vocaId: `voca-${index}`, reviewStage: 4, correctCount: 1, wrongCount: 0 })
		);
		const vocas = reviews.map((review, index) =>
			makeVoca({ _id: review.vocaId, difficultyLevel: index < 6 ? 1 : 2 })
		);
		expect(calculateVocabularyLevel(reviews, vocas)).toBeGreaterThan(1);
	});

	it('uses one latest answered review per voca', () => {
		const selected = selectRecentLevelReviews([
			makeReview({ _id: 'older', reviewStage: 5, lastReviewedAt: '2026-06-20T00:00:00.000Z' }),
			makeReview({
				_id: 'newer',
				reviewStage: 0,
				wrongCount: 2,
				lastReviewedAt: '2026-06-21T00:00:00.000Z'
			}),
			makeReview({
				_id: 'unanswered',
				vocaId: 'voca-2',
				correctCount: 0,
				wrongCount: 0,
				lastReviewedAt: '2026-06-22T00:00:00.000Z'
			})
		]);

		expect(selected.map((review) => review._id)).toEqual(['newer']);
	});

	it('limits level evidence to the most recent distinct vocas', () => {
		const reviews = Array.from({ length: 6 }, (_, index) =>
			makeReview({
				_id: `review-${index}`,
				vocaId: `voca-${index}`,
				correctCount: 1,
				lastReviewedAt: `2026-06-${String(index + 10).padStart(2, '0')}T00:00:00.000Z`
			})
		);

		expect(selectRecentLevelReviews(reviews, 3).map((review) => review.vocaId)).toEqual([
			'voca-5',
			'voca-4',
			'voca-3'
		]);
	});

	it('uses at most 500 distinct vocas by default', () => {
		const reviews = Array.from({ length: 501 }, (_, index) =>
			makeReview({
				_id: `review-${index}`,
				vocaId: `voca-${index}`,
				correctCount: 1,
				lastReviewedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
			})
		);

		const selected = selectRecentLevelReviews(reviews);

		expect(selected).toHaveLength(500);
		expect(selected[0]?.vocaId).toBe('voca-500');
		expect(selected.some((review) => review.vocaId === 'voca-0')).toBe(false);
	});

	it('updates currentLevel and throttles level history entries', () => {
		const currentUser = makeUser({
			currentLevel: 1,
			levelHistory: [{ level: 1, recordedAt: '2026-06-28T00:00:00.000Z' }]
		});
		const reviews = [makeReview({ reviewStage: 5, correctCount: 2, wrongCount: 0 })];
		const vocas = [makeVoca({ difficultyLevel: 7 })];
		const insideThrottle = rebuildUserLevel(
			currentUser,
			reviews,
			vocas,
			new Date('2026-06-28T01:00:00.000Z')
		);
		const afterThrottle = rebuildUserLevel(
			currentUser,
			reviews,
			vocas,
			new Date('2026-06-28T07:00:00.000Z')
		);

		expect(insideThrottle.currentLevel).toBeGreaterThan(1);
		expect(insideThrottle.levelHistory).toEqual(currentUser.levelHistory);
		expect(afterThrottle.levelHistory).toHaveLength(2);
		expect(afterThrottle.levelHistory[1]?.level).toBe(afterThrottle.currentLevel);
	});
});
