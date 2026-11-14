import { expect, it } from 'vitest';

import {
	cmuPronunciationsToIpa,
	lookupCmuPronunciations,
	storedCmuPronunciationToIpa
} from '$lib/server/cmu-pronunciation';

it('finds all documented variants and identifies missing tokens', () => {
	expect(lookupCmuPronunciations('became closer').missing).toEqual([]);
	expect(lookupCmuPronunciations('closer').words[0].candidates).toEqual(
		expect.arrayContaining(['K L OW1 S ER0', 'K L OW1 Z ER0'])
	);
	expect(lookupCmuPronunciations('closer zzzqvzz').missing).toEqual(['zzzqvzz']);
});

it('renders stress from CMU vowels at estimated syllable onsets', () => {
	expect(cmuPronunciationsToIpa(['B IH0 K EY1 M', 'K L OW1 S ER0'])).toBe('/bɪˈkeɪm ˈkloʊsɚ/');
	expect(cmuPronunciationsToIpa(['K L OW1 Z ER0'])).toBe('/ˈkloʊzɚ/');
	expect(storedCmuPronunciationToIpa('AE1 P AH0 L')).toBe('/ˈæpəl/');
	expect(storedCmuPronunciationToIpa('K AH0 M P Y UW1 T ER0')).toBe('/kəmˈpjutɚ/');
	expect(storedCmuPronunciationToIpa('R IY0 AE1 K T')).toBe('/ɹiˈækt/');
	expect(storedCmuPronunciationToIpa('IH2 N T ER0 N AE1 SH AH0 N AH0 L')).toBe('/ˌɪntɚˈnæʃənəl/');
	expect(storedCmuPronunciationToIpa('G OW1 | B AE1 K')).toBe('/ɡoʊ bæk/');
	expect(storedCmuPronunciationToIpa('invalid')).toBeUndefined();
	expect(storedCmuPronunciationToIpa(undefined)).toBeUndefined();
	expect(() => cmuPronunciationsToIpa(['B BADPHONE'])).toThrow('Unknown CMU phone');
});

it('does not include dictionary annotations in the candidate phonemes', () => {
	expect(lookupCmuPronunciations('hiv').words[0].candidates).toContain('EY1 CH AY1 V IY1');
	expect(lookupCmuPronunciations('hiv').words[0].candidates.every((x) => !x.includes('#'))).toBe(
		true
	);
});

it('does not silently ignore unsupported characters', () => {
	expect(lookupCmuPronunciations('read 123').missing).toEqual(['read 123']);
});
