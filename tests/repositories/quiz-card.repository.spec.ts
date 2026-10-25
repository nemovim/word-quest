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
		const newUserWindow = calculateQuizDifficultyWindow(1, 0);
		const experiencedWindow = calculateQuizDifficultyWindow(5, 500);

		expect(newUserWindow).toEqual({ lower: 1, upper: 2, spread: 1 });
		expect(experiencedWindow).toEqual({ lower: 4, upper: 6, spread: 2 });
		expect(calculateQuizDifficultyWindow(5.9, 0)).toEqual({ lower: 4, upper: 6, spread: 2 });
	});

	it('allocates 30% easier, 50% current, and 20% harder vocas', () => {
		expect(calculateQuizDifficultyQuotas(5.9, 10)).toEqual([
			{ difficultyLevel: 4, count: 3 },
			{ difficultyLevel: 5, count: 5 },
			{ difficultyLevel: 6, count: 2 }
		]);
		expect(calculateQuizDifficultyQuotas(1, 10)).toEqual([
			{ difficultyLevel: 1, count: 8 },
			{ difficultyLevel: 2, count: 2 }
		]);
	});

	it('preselects a fixed number of words per level and fills missing quotas from them', async () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const vocasByLevel = new Map([
			[
				4,
				[
					makeVoca({ _id: 'voca-easy-1', difficultyLevel: 4, originKey: 'easy-1' }),
					makeVoca({ _id: 'voca-easy-2', difficultyLevel: 4, originKey: 'easy-2' }),
					makeVoca({ _id: 'voca-fallback', difficultyLevel: 4, originKey: 'easy-3' })
				]
			],
			[5, []],
			[6, []],
			[7, []]
		]);
		const selectedVocas = ['voca-easy-1', 'voca-easy-2', 'voca-fallback'].map((_id, index) =>
			makeVoca({ _id, difficultyLevel: 4, originKey: `easy-${String(index + 1)}` })
		);
		vocaFindMock.mockImplementation((filter: { difficultyLevel?: number }) =>
			filter.difficultyLevel == null
				? { lean: async () => selectedVocas }
				: {
						sort: () => ({
							limit: () => ({
								select: () => ({
									lean: async () => vocasByLevel.get(filter.difficultyLevel ?? 0) ?? []
								})
							})
						})
					}
		);
		quizCardFindMock
			.mockReturnValueOnce({
				select: () => ({
					lean: async () =>
						['voca-easy-1', 'voca-easy-2', 'voca-fallback'].map((vocaId) => ({ vocaId }))
				})
			})
			.mockReturnValueOnce({
				lean: async () =>
					['voca-easy-1', 'voca-easy-2', 'voca-fallback'].map((vocaId) => makeQuizCard({ vocaId }))
			});

		const result = await findNewQuizCandidates({
			currentLevel: 5,
			evidenceCount: 500,
			excludedVocaIds: ['voca-reviewed'],
			limit: 10
		});

		expect(result.map((candidate) => candidate.voca._id)).toEqual([
			'voca-easy-1',
			'voca-easy-2',
			'voca-fallback'
		]);
		expect(vocaFindMock).toHaveBeenCalledTimes(4);
		expect(vocaFindMock).toHaveBeenCalledWith({
			difficultyLevel: 4,
			utilityScore: { $gte: 1 },
			quizExcludedByReportId: { $exists: false },
			_id: { $nin: ['voca-reviewed'] }
		});
		expect(quizCardFindMock).toHaveBeenNthCalledWith(1, {
			vocaId: { $in: ['voca-easy-1', 'voca-easy-2', 'voca-fallback'] },
			'examples.0': { $exists: true }
		});
		expect(quizCardFindMock).toHaveBeenNthCalledWith(2, {
			vocaId: { $in: ['voca-easy-1', 'voca-easy-2', 'voca-fallback'] },
			'examples.0': { $exists: true }
		});
		expect(vocaFindMock).toHaveBeenLastCalledWith({
			_id: { $in: ['voca-easy-1', 'voca-easy-2', 'voca-fallback'] }
		});
		expect(randomSpy).toHaveBeenCalledTimes(3);
	});

	it('does not query the database when no new cards are requested', async () => {
		await expect(
			findNewQuizCandidates({
				currentLevel: 3,
				evidenceCount: 0,
				excludedVocaIds: [],
				limit: 0
			})
		).resolves.toEqual([]);

		expect(vocaFindMock).not.toHaveBeenCalled();
		expect(quizCardFindMock).not.toHaveBeenCalled();
	});
});
