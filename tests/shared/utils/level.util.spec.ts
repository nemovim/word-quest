import { describe, expect, it } from 'vitest';

import { getNearestRankLevelPercentile, getWeeklyLevelDelta } from '$lib/shared/utils/level.util';

describe('level.util', () => {
	it('falls back to level 1 when no learned difficulties exist', () => {
		expect(getNearestRankLevelPercentile([], 0.75)).toBe(1);
	});

	it('uses nearest-rank percentile for current level calculation', () => {
		expect(getNearestRankLevelPercentile([2, 4, 6, 8], 0.75)).toBe(6);
	});

	it('calculates weekly level delta from recent history only', () => {
		const now = Date.now();
		const weeklyDelta = getWeeklyLevelDelta(6.2, [
			{ level: 5.1, recordedAt: new Date(now - 1000 * 60 * 60 * 24 * 2).toISOString() },
			{ level: 3.4, recordedAt: new Date(now - 1000 * 60 * 60 * 24 * 10).toISOString() }
		]);

		expect(weeklyDelta).toBe(1.1);
	});
});
