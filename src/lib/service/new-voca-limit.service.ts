import {
	countVocasFirstReviewedSince,
	hasReviewByUserAndVoca
} from '$lib/repositories/review.repository';

export const NEW_VOCA_LIMIT = 40;
export const NEW_VOCA_WINDOW_MS = 12 * 60 * 60 * 1000;
export const NEW_VOCA_LIMIT_MESSAGE =
	'최근 12시간 동안 학습할 수 있는 새 단어 40개를 모두 추가했어요. 기존 단어는 계속 복습할 수 있어요.';

export class NewVocaLimitError extends Error {
	constructor() {
		super(NEW_VOCA_LIMIT_MESSAGE);
		this.name = 'NewVocaLimitError';
	}
}

function getWindowStart(now: Date): Date {
	return new Date(now.getTime() - NEW_VOCA_WINDOW_MS);
}

export async function getRemainingNewVocaCount(userId: string, now: Date): Promise<number> {
	const currentCount = await countVocasFirstReviewedSince(
		userId,
		getWindowStart(now),
		NEW_VOCA_LIMIT
	);
	return Math.max(0, NEW_VOCA_LIMIT - currentCount);
}

export async function assertCanStartNewVoca(
	userId: string,
	vocaId: string,
	now: Date
): Promise<void> {
	if (await hasReviewByUserAndVoca(userId, vocaId)) {
		return;
	}

	if ((await getRemainingNewVocaCount(userId, now)) === 0) {
		throw new NewVocaLimitError();
	}
}
