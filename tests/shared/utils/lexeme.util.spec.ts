import { describe, expect, it } from 'vitest';

import { isEnglishLexemeSurface } from '$lib/shared/utils/lexeme.util';

describe('lexeme.util', () => {
	it('accepts noun and verb inflections of the supplied lexeme', () => {
		expect(isEnglishLexemeSurface('attempt', 'attempts', 'noun')).toBe(true);
		expect(isEnglishLexemeSurface('try', 'tries', 'noun')).toBe(true);
		expect(isEnglishLexemeSurface('try', 'trying', 'verb')).toBe(true);
		expect(isEnglishLexemeSurface('stop', 'stopped', 'verb')).toBe(true);
	});

	it('rejects a synonym or a part-of-speech-changing answer', () => {
		expect(isEnglishLexemeSurface('attempt', 'trying', 'noun')).toBe(false);
		expect(isEnglishLexemeSurface('try', 'attempt', 'noun')).toBe(false);
	});
});
