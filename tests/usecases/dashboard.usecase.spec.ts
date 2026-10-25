import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeUser } from '../helpers/factories';

import * as QuizReportRepository from '$lib/repositories/quiz-report.repository';
import * as ReviewRepository from '$lib/repositories/review.repository';
import * as VocaRepository from '$lib/repositories/voca.repository';
import { LONG_TERM_REVIEW_STAGE } from '$lib/shared/types/general.type';
import { loadSummary } from '$lib/usecases/dashboard.usecase';

describe('dashboard.usecase', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('passes pending reports and permanently blocked words to the summary', async () => {
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

		expect(getReviewSummarySpy).toHaveBeenCalledWith(
			user._id,
			expect.any(Date),
			LONG_TERM_REVIEW_STAGE,
			['reported', 'duplicate', 'blocked']
		);
	});
});
