import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { quizCardFindMock, vocaFindMock, countDocumentsMock } = vi.hoisted(() => ({
	quizCardFindMock: vi.fn(),
	vocaFindMock: vi.fn(),
	countDocumentsMock: vi.fn()
}));

vi.mock('$lib/models/quiz-card.model', () => ({
	default: {
		collection: { name: 'quizcards' },
		countDocuments: countDocumentsMock,
		find: quizCardFindMock
	}
}));

vi.mock('$lib/models/voca.model', () => ({
	default: { find: vocaFindMock }
}));

import { makeQuizCard, makeVoca } from '../helpers/factories';

import {
	calculateQuizDifficultyQuotas,
	calculateQuizDifficultyWindow,
	countVocasWithExamples,
	findNewQuizCandidates
} from '$lib/repositories/quiz-card.repository';

describe('quiz-card.repository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('counts only words that have at least one saved example', async () => {
		countDocumentsMock.mockResolvedValue(321);

		await expect(countVocasWithExamples()).resolves.toBe(321);
		expect(countDocumentsMock).toHaveBeenCalledWith({ 'examples.0': { $exists: true } });
	});

	it('keeps new vocas within one difficulty step of the floored current level', () => {
		const newUserWindow = calculateQuizDifficultyWindow(1);
		const experiencedWindow = calculateQuizDifficultyWindow(5);

		expect(newUserWindow).toEqual({ lower: 1, upper: 2, spread: 1 });
		expect(experiencedWindow).toEqual({ lower: 4, upper: 6, spread: 2 });
		expect(calculateQuizDifficultyWindow(5.9)).toEqual({ lower: 4, upper: 6, spread: 2 });
	});

	it('allocates 20% easier, 40% current, and 40% harder vocas', () => {
		expect(calculateQuizDifficultyQuotas(5.9, 10)).toEqual([
			{ difficultyLevel: 4, count: 2 },
			{ difficultyLevel: 5, count: 4 },
			{ difficultyLevel: 6, count: 4 }
		]);
		expect(calculateQuizDifficultyQuotas(1, 10)).toEqual([
			{ difficultyLevel: 1, count: 6 },
			{ difficultyLevel: 2, count: 4 }
		]);
		expect(calculateQuizDifficultyQuotas(10, 10)).toEqual([
			{ difficultyLevel: 9, count: 2 },
			{ difficultyLevel: 10, count: 8 }
		]);
	});

	it('includes fractional words in the nearest difficulty quota and fills missing quotas', async () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const fractional = makeVoca({
			_id: 'voca-fractional',
			difficultyLevel: 3.93,
			utilityScore: 5,
			originKey: 'easy-1'
		});
		const vocasByLevel = new Map([
			[
				4,
				[
					makeVoca({
						_id: 'voca-easy-2',
						difficultyLevel: 4,
						utilityScore: 4,
						originKey: 'easy-2'
					}),
					makeVoca({
						_id: 'voca-fallback',
						difficultyLevel: 4,
						utilityScore: 4,
						originKey: 'easy-3'
					})
				]
			],
			[5, []],
			[6, []],
			[7, []]
		]);
		const selectedVocas = [fractional, ...(vocasByLevel.get(4) ?? [])];
		const selectedIds = selectedVocas.map((voca) => voca._id);
		type CandidateFilter = {
			difficultyLevel?: number;
			$or?: { difficultyLevel: { $gte?: number } }[];
		};
		vocaFindMock.mockImplementation((filter: CandidateFilter) =>
			filter.difficultyLevel == null && filter.$or == null
				? { lean: async () => selectedVocas }
				: {
						sort: () => ({
							limit: () => ({
								select: () => ({
									lean: async () =>
										filter.$or
											? filter.$or[0]?.difficultyLevel.$gte === 3.5
												? [fractional]
												: []
											: (vocasByLevel.get(filter.difficultyLevel ?? 0) ?? [])
								})
							})
						})
					}
		);
		quizCardFindMock
			.mockReturnValueOnce({
				select: () => ({
					lean: async () => selectedIds.map((vocaId) => ({ vocaId }))
				})
			})
			.mockReturnValueOnce({
				lean: async () => selectedIds.map((vocaId) => makeQuizCard({ vocaId }))
			});

		const result = await findNewQuizCandidates({
			currentLevel: 5,
			excludedVocaIds: ['voca-reviewed'],
			limit: 10
		});

		expect(result.map((candidate) => candidate.voca._id)).toEqual([
			'voca-fractional',
			'voca-easy-2',
			'voca-fallback'
		]);
		expect(result[0]?.voca.difficultyLevel).toBe(3.93);
		expect(vocaFindMock).toHaveBeenCalledTimes(7);
		expect(vocaFindMock).toHaveBeenCalledWith({
			$or: [{ difficultyLevel: { $gte: 3.5, $lt: 4 } }, { difficultyLevel: { $gt: 4, $lt: 4.5 } }],
			utilityScore: { $gte: 1 },
			quizExcludedByReportId: { $exists: false },
			_id: { $nin: ['voca-reviewed'] }
		});
		expect(vocaFindMock).toHaveBeenCalledWith({
			difficultyLevel: 4,
			utilityScore: { $gte: 1 },
			quizExcludedByReportId: { $exists: false },
			_id: { $nin: ['voca-reviewed'] }
		});
		expect(quizCardFindMock).toHaveBeenNthCalledWith(1, {
			vocaId: { $in: selectedIds },
			'examples.0': { $exists: true }
		});
		expect(quizCardFindMock).toHaveBeenNthCalledWith(2, {
			vocaId: { $in: selectedIds },
			'examples.0': { $exists: true }
		});
		expect(vocaFindMock).toHaveBeenLastCalledWith({
			_id: { $in: selectedIds }
		});
		expect(randomSpy).toHaveBeenCalledTimes(3);
	});

	it('does not query the database when no new cards are requested', async () => {
		await expect(
			findNewQuizCandidates({
				currentLevel: 3,
				excludedVocaIds: [],
				limit: 0
			})
		).resolves.toEqual([]);

		expect(vocaFindMock).not.toHaveBeenCalled();
		expect(quizCardFindMock).not.toHaveBeenCalled();
	});
});
