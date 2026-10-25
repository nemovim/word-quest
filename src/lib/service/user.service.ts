import type { LevelReview } from '$lib/shared/types/review.type';
import type { User } from '$lib/shared/types/user.type';
import type { Voca } from '$lib/shared/types/voca.type';

import {
	createUser,
	findUserById as findStoredUserById,
	getUserById as getStoredUserById,
	saveUser as saveStoredUser
} from '$lib/repositories/user.repository';
import {
	LEVEL_HISTORY_INTERVAL_MS,
	MAX_LEVEL,
	MAX_REVIEW_STAGE,
	MIN_LEVEL
} from '$lib/shared/types/general.type';
import { clampNumber, roundTo2 } from '$lib/shared/utils/general.util';

const LEVEL_SAMPLE_LIMIT = 500;
const LEVEL_SEARCH_ITERATIONS = 16;
const LEVEL_PROBABILITY_SCALE = 1.25;
const LEVEL_PRIOR_WEIGHT = 0.5;
const LEVEL_MASTERY_BASELINE = 0.8;
const LEVEL_MASTERY_BASELINE_LOGIT = Math.log(
	LEVEL_MASTERY_BASELINE / (1 - LEVEL_MASTERY_BASELINE)
);
const MASTERY_BY_STAGE = [0, 0.2, 0.4, 0.6, 0.75, 0.78, 0.8, 0.81] as const;

function shouldAppendLevelHistory(currentUser: User, now: Date): boolean {
	const lastHistory = currentUser.levelHistory.at(-1);

	return (
		lastHistory != null &&
		new Date(lastHistory.recordedAt).getTime() + LEVEL_HISTORY_INTERVAL_MS <= now.getTime()
	);
}

function seedOrAppendLevelHistory(currentUser: User, nextLevel: number, now: Date): User {
	if (currentUser.levelHistory.length === 0) {
		return {
			...currentUser,
			levelHistory: [{ level: nextLevel, recordedAt: now.toISOString() }]
		};
	}

	if (!shouldAppendLevelHistory(currentUser, now)) {
		return currentUser;
	}

	return {
		...currentUser,
		levelHistory: [...currentUser.levelHistory, { level: nextLevel, recordedAt: now.toISOString() }]
	};
}

function getStageMastery(reviewStage: number): number {
	const stageIndex = Math.trunc(clampNumber(reviewStage, 0, MAX_REVIEW_STAGE));
	return MASTERY_BY_STAGE[stageIndex] ?? 0;
}

export function selectRecentLevelReviews<T extends LevelReview>(
	reviews: T[],
	limit = LEVEL_SAMPLE_LIMIT
): T[] {
	const latestByVocaId = new Map<string, T>();

	for (const currentReview of reviews) {
		if (currentReview.correctCount + currentReview.wrongCount === 0) {
			continue;
		}

		const previousReview = latestByVocaId.get(currentReview.vocaId);
		if (
			previousReview == null ||
			new Date(currentReview.lastReviewedAt).getTime() >
				new Date(previousReview.lastReviewedAt).getTime()
		) {
			latestByVocaId.set(currentReview.vocaId, currentReview);
		}
	}

	return [...latestByVocaId.values()]
		.sort(
			(left, right) =>
				new Date(right.lastReviewedAt).getTime() - new Date(left.lastReviewedAt).getTime()
		)
		.slice(0, limit);
}

function getExpectedMastery(level: number, difficultyLevel: number): number {
	const logit = (level - difficultyLevel) / LEVEL_PROBABILITY_SCALE + LEVEL_MASTERY_BASELINE_LOGIT;
	return 1 / (1 + Math.exp(-logit));
}

export function calculateVocabularyLevel(reviews: LevelReview[], vocas: Voca[]): number {
	const selectedReviews = selectRecentLevelReviews(reviews);
	const vocaById = new Map(vocas.map((currentVoca) => [currentVoca._id, currentVoca]));
	const samples = selectedReviews.flatMap((currentReview) => {
		const difficultyLevel = vocaById.get(currentReview.vocaId)?.difficultyLevel;

		return difficultyLevel == null
			? []
			: [{ difficultyLevel, mastery: getStageMastery(currentReview.reviewStage) }];
	});

	if (samples.length === 0) {
		return MIN_LEVEL;
	}

	const getLossDerivative = (level: number) =>
		samples.reduce(
			(total, sample) =>
				total +
				(getExpectedMastery(level, sample.difficultyLevel) - sample.mastery) /
					LEVEL_PROBABILITY_SCALE,
			LEVEL_PRIOR_WEIGHT * (level - MIN_LEVEL)
		);

	if (getLossDerivative(MIN_LEVEL) >= 0) {
		return MIN_LEVEL;
	}

	if (getLossDerivative(MAX_LEVEL) <= 0) {
		return MAX_LEVEL;
	}

	let lowerLevel = MIN_LEVEL;
	let upperLevel = MAX_LEVEL;

	for (let iteration = 0; iteration < LEVEL_SEARCH_ITERATIONS; iteration += 1) {
		const middleLevel = (lowerLevel + upperLevel) / 2;

		if (getLossDerivative(middleLevel) < 0) {
			lowerLevel = middleLevel;
		} else {
			upperLevel = middleLevel;
		}
	}

	return roundTo2(clampNumber((lowerLevel + upperLevel) / 2, MIN_LEVEL, MAX_LEVEL));
}

export async function getOrCreateUser(userId: string, email: string, name: string): Promise<User> {
	const existingUser = await findStoredUserById(userId);

	if (existingUser != null) {
		return existingUser;
	}

	return createUser(userId, {
		email,
		name,
		currentLevel: MIN_LEVEL,
		levelHistory: [{ level: MIN_LEVEL, recordedAt: new Date().toISOString() }]
	});
}

export async function getUserById(userId: string): Promise<User> {
	return getStoredUserById(userId);
}

export async function saveUser(currentUser: User): Promise<User> {
	return saveStoredUser(currentUser);
}

export function rebuildUserLevel(
	currentUser: User,
	reviews: LevelReview[],
	vocas: Voca[],
	now: Date
): User {
	const nextLevel = calculateVocabularyLevel(reviews, vocas);
	const nextUser =
		currentUser.currentLevel === nextLevel
			? currentUser
			: {
					...currentUser,
					currentLevel: nextLevel
				};

	return seedOrAppendLevelHistory(nextUser, nextLevel, now);
}
