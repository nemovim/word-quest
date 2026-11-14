import type { DashboardSummary } from '$lib/shared/types/dashboard.type';
import type { User } from '$lib/shared/types/user.type';

import { findPendingReportedVocaIds } from '$lib/repositories/quiz-report.repository';
import {
	countStudiedVocasByUser,
	findReviewVocaIdsByUser,
	getReviewSummary
} from '$lib/repositories/review.repository';
import { findUsersForRanking } from '$lib/repositories/user.repository';
import { findPermanentlyExcludedVocaIds } from '$lib/repositories/voca.repository';
import { LONG_TERM_REVIEW_STAGE } from '$lib/shared/types/general.type';
import { getWeeklyLevelDelta } from '$lib/shared/utils/level.util';

export async function loadRanking(user: User) {
	const [users, counts] = await Promise.all([findUsersForRanking(), countStudiedVocasByUser()]);
	const countByUser = new Map(counts.map(({ userId, count }) => [userId, count]));
	let rank = 0;
	return users.map((entry, index) => {
		if (index === 0 || entry.currentLevel !== users[index - 1].currentLevel) rank = index + 1;
		return {
			rank,
			name: entry.email.split('@')[0],
			level: entry.currentLevel,
			studiedCount: countByUser.get(entry._id) ?? 0,
			isCurrentUser: entry._id === user._id
		};
	});
}

export async function loadSummary(user: User): Promise<DashboardSummary> {
	const now = new Date();
	const [pendingReportedVocaIds, reviewVocaIds] = await Promise.all([
		findPendingReportedVocaIds(),
		findReviewVocaIdsByUser(user._id)
	]);
	const permanentlyExcludedVocaIds = await findPermanentlyExcludedVocaIds(reviewVocaIds);
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
