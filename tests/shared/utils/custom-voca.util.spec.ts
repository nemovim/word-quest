import { describe, expect, it } from 'vitest';

import type { Voca } from '$lib/shared/types/voca.type';

import { LANGUAGE_CODES } from '$lib/shared/types/general.type';
import {
	buildCustomOriginKey,
	getCustomSenseNumber,
	getNextCustomSenseNumber
} from '$lib/shared/utils/custom-voca.util';

describe('custom voca utilities', () => {
	it('builds a readable normalized origin key', () => {
		expect(
			buildCustomOriginKey({
				sourceText: '  적격  ',
				senseNumber: 2,
				targetLang: LANGUAGE_CODES.EN,
				targetText: ' Being   Qualified '
			})
		).toBe('custom:적격:2:en:being qualified');
	});

	it('escapes origin-key separators without hiding Korean text', () => {
		expect(
			buildCustomOriginKey({
				sourceText: '표현:설명',
				senseNumber: 1,
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'ratio: 100%'
			})
		).toBe('custom:표현%3A설명:1:en:ratio%3A 100%25');
	});

	it('allocates the next sense number while ignoring legacy custom keys', () => {
		const vocas = [
			{ originKey: 'custom:적격:1:en:qualified' },
			{ originKey: 'custom:적격:3:en:eligible' },
			{ originKey: 'custom:legacy-uuid' },
			{ originKey: 'krdict:1:1:en:qualified' }
		] as Voca[];

		expect(getCustomSenseNumber(vocas[1].originKey, '적격')).toBe(3);
		expect(getNextCustomSenseNumber('적격', vocas)).toBe(4);
	});
});
