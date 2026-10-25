import { beforeEach, describe, expect, it, vi } from 'vitest';

const { countVocasFirstReviewedSinceMock, hasReviewByUserAndVocaMock } = vi.hoisted(() => ({
	countVocasFirstReviewedSinceMock: vi.fn(),
	hasReviewByUserAndVocaMock: vi.fn()
}));

vi.mock('$lib/repositories/review.repository', () => ({
	countVocasFirstReviewedSince: countVocasFirstReviewedSinceMock,
	hasReviewByUserAndVoca: hasReviewByUserAndVocaMock
}));

import {
	assertCanStartNewVoca,
	getRemainingNewVocaCount,
	NEW_VOCA_LIMIT_MESSAGE
} from '$lib/service/new-voca-limit.service';

describe('new voca limit service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hasReviewByUserAndVocaMock.mockResolvedValue(false);
	});

	it('returns the remaining slots in the rolling 12-hour window', async () => {
		countVocasFirstReviewedSinceMock.mockResolvedValue(37);
		const now = new Date('2026-07-24T12:00:00.000Z');

		await expect(getRemainingNewVocaCount('user-1', now)).resolves.toBe(3);
		expect(countVocasFirstReviewedSinceMock).toHaveBeenCalledWith(
			'user-1',
			new Date('2026-07-24T00:00:00.000Z'),
			40
		);
	});

	it('allows an already-known voca without consuming a new slot', async () => {
		hasReviewByUserAndVocaMock.mockResolvedValue(true);

		await expect(assertCanStartNewVoca('user-1', 'voca-1', new Date())).resolves.toBeUndefined();
		expect(countVocasFirstReviewedSinceMock).not.toHaveBeenCalled();
	});

	it('rejects a new voca after all 40 slots are used', async () => {
		countVocasFirstReviewedSinceMock.mockResolvedValue(40);

		await expect(assertCanStartNewVoca('user-1', 'voca-new', new Date())).rejects.toThrow(
			NEW_VOCA_LIMIT_MESSAGE
		);
	});
});
