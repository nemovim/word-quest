import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMock, sortMock, limitMock, leanMock } = vi.hoisted(() => ({
	findMock: vi.fn(),
	sortMock: vi.fn(),
	limitMock: vi.fn(),
	leanMock: vi.fn()
}));

vi.mock('$lib/models/voca.model', () => ({
	default: {
		find: findMock
	}
}));

import {
	buildTargetTextSearch,
	findVocasBySourceText,
	normalizeSourceText,
	normalizeTargetText
} from '$lib/repositories/voca.repository';
import { LANGUAGE_CODES } from '$lib/shared/types/general.type';

describe('voca.repository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sortMock.mockReturnValue({ limit: limitMock });
		limitMock.mockReturnValue({ lean: leanMock });
		findMock.mockReturnValue({ sort: sortMock });
		leanMock.mockResolvedValue([]);
	});

	it('normalizes Korean source text with trimmed whitespace', () => {
		expect(normalizeSourceText('  \uac00\ub2e4   \ud558\ub2e4  ')).toBe(
			'\uac00\ub2e4 \ud558\ub2e4'
		);
	});

	it('normalizes English target text case-insensitively', () => {
		expect(normalizeTargetText('  Bear  ', LANGUAGE_CODES.EN)).toBe('bear');
	});

	it('keeps non-English target text as trimmed text', () => {
		expect(normalizeTargetText('  \u98df\u3079\u308b  ', LANGUAGE_CODES.JA)).toBe(
			'\u98df\u3079\u308b'
		);
	});

	it('matches an English search term as a standalone part of a phrase', () => {
		const search = buildTargetTextSearch('  Delighted  ', LANGUAGE_CODES.EN);

		expect(search).toBeInstanceOf(RegExp);
		expect('be delighted').toMatch(search);
		expect('delighted').toMatch(search);
		expect('undelighted').not.toMatch(search);
	});

	it('searches by either source text or normalized target text', async () => {
		await findVocasBySourceText(LANGUAGE_CODES.EN, '  Bear  ');

		expect(findMock).toHaveBeenCalledWith({
			targetLang: LANGUAGE_CODES.EN,
			$or: [{ sourceText: 'Bear' }, { normalizedTargetText: /(^|[^a-z0-9])bear($|[^a-z0-9])/ }]
		});
		expect(sortMock).toHaveBeenCalledWith({ normalizedTargetText: 1, originKey: 1 });
		expect(limitMock).toHaveBeenCalledWith(100);
	});

	it('does not scan English translations for a Korean search term', async () => {
		await findVocasBySourceText(LANGUAGE_CODES.EN, '개정');

		expect(findMock).toHaveBeenCalledWith({
			targetLang: LANGUAGE_CODES.EN,
			sourceText: '개정'
		});
	});
});
