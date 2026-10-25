import { MAX_LEVEL, MIN_LEVEL } from '$lib/shared/types/general.type';
import { clampNumber, roundTo2 } from '$lib/shared/utils/general.util';

export function getNearestRankLevelPercentile(levels: number[], percentile: number): number {
	if (levels.length === 0) {
		return MIN_LEVEL;
	}

	const sortedLevels = [...levels].sort((left, right) => left - right);
	const rank = Math.max(1, Math.ceil(sortedLevels.length * percentile));
	const nextLevel = sortedLevels[Math.min(sortedLevels.length - 1, rank - 1)];

	return clampNumber(roundTo2(nextLevel), MIN_LEVEL, MAX_LEVEL);
}

export function getWeeklyLevelDelta(
	currentLevel: number,
	levelHistory: Array<{ level: number; recordedAt: string }>
): number {
	const threshold = Date.now() - 1000 * 60 * 60 * 24 * 7;
	const weeklyEntries = levelHistory.filter(
		(history) => new Date(history.recordedAt).getTime() >= threshold
	);

	if (weeklyEntries.length === 0) {
		return 0;
	}

	return roundTo2(currentLevel - weeklyEntries[0].level);
}
