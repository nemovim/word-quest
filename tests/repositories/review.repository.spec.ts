import { beforeEach, describe, expect, it, vi } from 'vitest';

const { aggregateMock, distinctMock } = vi.hoisted(() => ({
	aggregateMock: vi.fn(),
	distinctMock: vi.fn()
}));

vi.mock('$lib/models/review.model', () => ({
	default: { aggregate: aggregateMock, distinct: distinctMock }
}));

import {
	countDistinctAnsweredVocasByUser,
	countVocasFirstReviewedSince,
	findDueReviewGroupsByUser,
	findRecentDistinctAnsweredReviews,
	findReviewedVocaIdsByUserDirection,
	getReviewSummary
} from '$lib/repositories/review.repository';

describe('review.repository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('limits level evidence in MongoDB and projects only calculation fields', async () => {
		aggregateMock.mockResolvedValue([]);

		await findRecentDistinctAnsweredReviews('user-1', 500);

		const pipeline = aggregateMock.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
		expect(pipeline).toContainEqual({ $limit: 500 });
		expect(pipeline.at(-1)).toEqual({
			$project: {
				_id: 0,
				vocaId: 1,
				reviewStage: 1,
				correctCount: 1,
				wrongCount: 1,
				lastReviewedAt: 1
			}
		});
	});

	it('orders due reviews first with random tie breaking', async () => {
		const now = new Date('2026-09-10T00:00:00.000Z');
		aggregateMock
			.mockResolvedValueOnce([{ _id: 'reviewed' }])
			.mockResolvedValueOnce([{ _id: 'new' }]);

		await expect(
			findDueReviewGroupsByUser('user-1', 'promptLang', 'ko', now, 8, ['blocked'])
		).resolves.toEqual({ reviewed: [{ _id: 'reviewed' }], new: [{ _id: 'new' }] });
		expect(aggregateMock).toHaveBeenNthCalledWith(1, [
			{
				$match: {
					userId: 'user-1',
					promptLang: 'ko',
					dueAt: { $lte: now },
					vocaId: { $nin: ['blocked'] },
					$or: [{ correctCount: { $gt: 0 } }, { wrongCount: { $gt: 0 } }]
				}
			},
			{ $set: { randomOrder: { $rand: {} } } },
			{ $sort: { dueAt: 1, randomOrder: 1 } },
			{ $limit: 8 },
			{ $unset: 'randomOrder' }
		]);
		expect(aggregateMock).toHaveBeenNthCalledWith(2, [
			{
				$match: {
					userId: 'user-1',
					promptLang: 'ko',
					dueAt: { $lte: now },
					vocaId: { $nin: ['blocked'] },
					correctCount: 0,
					wrongCount: 0
				}
			},
			{ $set: { randomOrder: { $rand: {} } } },
			{ $sort: { dueAt: 1, randomOrder: 1 } },
			{ $limit: 8 },
			{ $unset: 'randomOrder' }
		]);
	});

	it('returns zero dashboard counts without review documents', async () => {
		aggregateMock.mockResolvedValue([]);

		await expect(getReviewSummary('user-1', new Date(), 6, [])).resolves.toEqual({
			totalReviewCount: 0,
			todayStudiedCount: 0,
			dueCount: 0,
			queuedNewCount: 0,
			learningCount: 0,
			memorizedCount: 0
		});
	});

	it('separates distinct answered reviews from queued new words and excludes unavailable work', async () => {
		aggregateMock.mockResolvedValue([]);
		const now = new Date('2026-09-10T00:00:00.000Z');

		await getReviewSummary('user-1', now, 6, ['reported', 'blocked']);

		const pipeline = aggregateMock.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
		expect(pipeline).toEqual([
			{ $match: { userId: 'user-1' } },
			expect.objectContaining({
				$group: expect.objectContaining({
					_id: '$vocaId',
					answered: expect.any(Object),
					dueReview: expect.any(Object),
					queuedNew: expect.any(Object),
					highestAnsweredStage: expect.any(Object)
				})
			}),
			expect.objectContaining({
				$group: expect.objectContaining({
					_id: null,
					totalReviewCount: { $sum: '$answered' },
					dueCount: { $sum: '$dueReview' },
					queuedNewCount: expect.any(Object),
					learningCount: expect.any(Object),
					memorizedCount: expect.any(Object)
				})
			}),
			{ $project: { _id: 0 } }
		]);
		expect(JSON.stringify(pipeline)).toContain(
			JSON.stringify({ $not: [{ $in: ['$vocaId', ['reported', 'blocked']] }] })
		);
	});

	it('counts each studied word once since Korean midnight', async () => {
		aggregateMock.mockResolvedValue([]);
		const now = new Date('2026-10-20T15:01:00.000Z');
		await getReviewSummary('user-1', now, 6, []);
		const pipeline = aggregateMock.mock.calls[0][0];
		expect(pipeline[1].$group.todayStudied).toEqual({
			$max: {
				$cond: [
					{
						$and: [
							{ $or: [{ $gt: ['$correctCount', 0] }, { $gt: ['$wrongCount', 0] }] },
							{ $gte: ['$lastReviewedAt', new Date('2026-10-20T15:00:00.000Z')] },
							{ $lte: ['$lastReviewedAt', now] }
						]
					},
					1,
					0
				]
			}
		});
		expect(pipeline[1].$group._id).toBe('$vocaId');
		expect(pipeline[2].$group.todayStudiedCount).toEqual({ $sum: '$todayStudied' });
	});
	it('counts distinct answered vocas up to the requested evidence limit', async () => {
		aggregateMock.mockResolvedValue([{ count: 37 }]);

		await expect(countDistinctAnsweredVocasByUser('user-1', 500)).resolves.toBe(37);
		expect(aggregateMock).toHaveBeenCalledWith([
			{
				$match: {
					userId: 'user-1',
					$or: [{ correctCount: { $gt: 0 } }, { wrongCount: { $gt: 0 } }]
				}
			},
			{ $group: { _id: '$vocaId' } },
			{ $limit: 500 },
			{ $count: 'count' }
		]);
	});

	it('loads reviewed voca ids for one quiz direction', async () => {
		distinctMock.mockResolvedValue(['voca-1', 'voca-2']);

		await expect(findReviewedVocaIdsByUserDirection('user-1', 'promptLang', 'ko')).resolves.toEqual(
			['voca-1', 'voca-2']
		);
		expect(distinctMock).toHaveBeenCalledWith('vocaId', {
			userId: 'user-1',
			promptLang: 'ko'
		});
	});

	it('counts distinct vocas by their first review time', async () => {
		aggregateMock.mockResolvedValue([{ count: 12 }]);
		const since = new Date('2026-07-24T00:00:00.000Z');

		await expect(countVocasFirstReviewedSince('user-1', since, 40)).resolves.toBe(12);
		expect(aggregateMock).toHaveBeenCalledWith([
			{ $match: { userId: 'user-1' } },
			{ $group: { _id: '$vocaId', firstReviewedAt: { $min: '$createdAt' } } },
			{ $match: { firstReviewedAt: { $gte: since } } },
			{ $limit: 40 },
			{ $count: 'count' }
		]);
	});
});
