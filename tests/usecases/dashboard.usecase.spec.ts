import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeUser } from '../helpers/factories';

import * as QuizReportRepository from '$lib/repositories/quiz-report.repository';
import * as ReviewRepository from '$lib/repositories/review.repository';
import * as UserRepository from '$lib/repositories/user.repository';
import * as VocaRepository from '$lib/repositories/voca.repository';
import { LONG_TERM_REVIEW_STAGE } from '$lib/shared/types/general.type';
import { loadRanking, loadSummary } from '$lib/usecases/dashboard.usecase';

describe('dashboard.usecase', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns shared ranks and only public ranking details', async () => {
		vi.spyOn(ReviewRepository, 'countStudiedVocasByUser').mockResolvedValue([
			{ userId: 'me', count: 12 },
			{ userId: 'third', count: 30 }
		]);
		vi.spyOn(UserRepository, 'findUsersForRanking').mockResolvedValue([
			{ _id: 'first', email: 'alpha@example.com', currentLevel: 3 },
			{ _id: 'me', email: 'beta@example.org', currentLevel: 3 },
			{ _id: 'third', email: 'gamma@example.com', currentLevel: 2 }
		]);

		expect(await loadRanking(makeUser({ _id: 'me' }))).toEqual([
			{ rank: 1, name: 'alpha', level: 3, studiedCount: 0, isCurrentUser: false },
			{ rank: 1, name: 'beta', level: 3, studiedCount: 12, isCurrentUser: true },
			{ rank: 3, name: 'gamma', level: 2, studiedCount: 30, isCurrentUser: false }
		]);
	});

	it('passes pending reports and permanently blocked words to the summary', async () => {
		vi.spyOn(ReviewRepository, 'findReviewVocaIdsByUser').mockResolvedValue([
			'blocked',
			'duplicate'
		]);
		vi.spyOn(QuizReportRepository, 'findPendingReportedVocaIds').mockResolvedValue([
			'reported',
			'duplicate'
		]);
		vi.spyOn(VocaRepository, 'findPermanentlyExcludedVocaIds').mockResolvedValue([
			'blocked',
			'duplicate'
		]);
		const getReviewSummarySpy = vi.spyOn(ReviewRepository, 'getReviewSummary').mockResolvedValue({
			totalReviewCount: 0,
			todayStudiedCount: 0,
			dueCount: 0,
			queuedNewCount: 0,
			learningCount: 0,
			memorizedCount: 0
		});
		const user = makeUser();

		await loadSummary(user);
		expect(VocaRepository.findPermanentlyExcludedVocaIds).toHaveBeenCalledWith([
			'blocked',
			'duplicate'
		]);

		expect(getReviewSummarySpy).toHaveBeenCalledWith(
			user._id,
			expect.any(Date),
			LONG_TERM_REVIEW_STAGE,
			['reported', 'duplicate', 'blocked']
		);
	});
});
