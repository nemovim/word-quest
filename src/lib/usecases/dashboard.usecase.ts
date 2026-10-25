import type { DashboardSummary } from '$lib/shared/types/dashboard.type';
import type { User } from '$lib/shared/types/user.type';

import { findPendingReportedVocaIds } from '$lib/repositories/quiz-report.repository';
import { getReviewSummary } from '$lib/repositories/review.repository';
import { findPermanentlyExcludedVocaIds } from '$lib/repositories/voca.repository';
import { LONG_TERM_REVIEW_STAGE } from '$lib/shared/types/general.type';
import { getWeeklyLevelDelta } from '$lib/shared/utils/level.util';

export async function loadSummary(user: User): Promise<DashboardSummary> {
	const now = new Date();
	const [pendingReportedVocaIds, permanentlyExcludedVocaIds] = await Promise.all([
		findPendingReportedVocaIds(),
		findPermanentlyExcludedVocaIds()
	]);
	const excludedVocaIds = Array.from(
		new Set([...pendingReportedVocaIds, ...permanentlyExcludedVocaIds])
	);
	const reviewSummary = await getReviewSummary(
		user._id,
		now,
		LONG_TERM_REVIEW_STAGE,
		excludedVocaIds
	);

	return {
		...reviewSummary,
		weeklyLevelDelta: getWeeklyLevelDelta(user.currentLevel, user.levelHistory)
	};
}
