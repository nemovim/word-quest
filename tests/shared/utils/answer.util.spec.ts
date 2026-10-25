import { describe, expect, it } from 'vitest';

import { QUIZ_TEMPLATE_SLOT } from '$lib/shared/types/general.type';
import {
	fillQuizTemplate,
	getCloseAnswerDistance,
	getAnswerInitialHint,
	getAnswerWordCount,
	splitQuizTemplate
} from '$lib/shared/utils/answer.util';

describe('answer.util', () => {
	it('fills templates even when characters are adjacent to the slot', () => {
		expect.assertions(2);

		expect(fillQuizTemplate(`I collect${QUIZ_TEMPLATE_SLOT}s.`, ' word')).toBe('I collect words.');
		expect(fillQuizTemplate(`A${QUIZ_TEMPLATE_SLOT}B`, '-')).toBe('A-B');
	});

	it('splits templates around the quiz slot', () => {
		expect.assertions(2);

		expect(splitQuizTemplate(`I collect${QUIZ_TEMPLATE_SLOT}s.`)).toEqual({
			before: 'I collect',
			after: 's.'
		});
		expect(splitQuizTemplate(`(${QUIZ_TEMPLATE_SLOT})`)).toEqual({
			before: '(',
			after: ')'
		});
	});

	it('counts whitespace-separated answer words', () => {
		expect(getAnswerWordCount('being delighted')).toBe(2);
		expect(getAnswerWordCount('  be   supposed to ')).toBe(3);
		expect(getAnswerWordCount('기쁘다')).toBe(1);
	});

	it('builds an initial hint for each answer word', () => {
		expect(getAnswerInitialHint('apple')).toBe('a…');
		expect(getAnswerInitialHint('  take   care of ')).toBe('t… c… o…');
		expect(getAnswerInitialHint('“well-known” phrase')).toBe('w… p…');
		expect(getAnswerInitialHint('기분 좋다')).toBe('기… 좋…');
	});
});

describe('getCloseAnswerDistance', () => {
	it('counts close substitutions, insertions and deletions', () => {
		expect(getCloseAnswerDistance('applf', 'apple', 'en')).toBe(1);
		expect(getCloseAnswerDistance('aple', 'apple', 'en')).toBe(1);
		expect(getCloseAnswerDistance('appple', 'apple', 'en')).toBe(1);
		expect(getCloseAnswerDistance('elefant', 'elephant', 'en')).toBe(2);
	});
	it('ignores normalized matches and unrelated or empty answers', () => {
		expect(getCloseAnswerDistance(' APPLE ', 'apple', 'en')).toBeNull();
		expect(getCloseAnswerDistance('', 'apple', 'en')).toBeNull();
		expect(getCloseAnswerDistance('orange', 'apple', 'en')).toBeNull();
		expect(getCloseAnswerDistance('a', 'an', 'en')).toBeNull();
	});
});
