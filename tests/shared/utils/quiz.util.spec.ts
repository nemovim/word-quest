import { describe, expect, it } from 'vitest';

import type { QuizExample } from '$lib/shared/types/quiz-card.type';

import { pickWeightedQuizExample, shuffleItems } from '$lib/shared/utils/quiz.util';

function makeQuizExample(id: string): QuizExample {
	return {
		_id: id,
		sourceSentenceTemplate: `ko {{---}} ${id}`,
		sourceFillText: `${id}-ko`,
		targetSentenceTemplate: `en {{---}} ${id}`,
		targetFillText: `${id}-en`,
		targetPronunciationText: `${id}-pronunciation`,
		reportCount: 0,
		addedAt: '2026-06-21T00:00:00.000Z'
	};
}

describe('quiz.util', () => {
	it('shuffles a copied list without changing the original order', () => {
		const items = ['a', 'b', 'c'];

		expect(shuffleItems(items, () => 0)).toEqual(['b', 'c', 'a']);
		expect(items).toEqual(['a', 'b', 'c']);
	});

	it('starts with equal probability when all example scores are zero', () => {
		const examples = [makeQuizExample('example-a'), makeQuizExample('example-b')];
		const picks = Array.from(
			{ length: 100 },
			(_, index) => pickWeightedQuizExample(examples, {}, undefined, (index + 0.5) / 100)._id
		);

		expect(picks.filter((value) => value === 'example-a')).toHaveLength(50);
		expect(picks.filter((value) => value === 'example-b')).toHaveLength(50);
	});

	it('favors examples with higher weakness scores', () => {
		const examples = [makeQuizExample('example-a'), makeQuizExample('example-b')];
		const picks = Array.from(
			{ length: 100 },
			(_, index) =>
				pickWeightedQuizExample(examples, { 'example-b': 4 }, undefined, (index + 0.5) / 100)._id
		);

		expect(picks.filter((value) => value === 'example-a')).toHaveLength(17);
		expect(picks.filter((value) => value === 'example-b')).toHaveLength(83);
	});

	it('avoids repeating the last example when another example is available', () => {
		const examples = [makeQuizExample('example-a'), makeQuizExample('example-b')];
		const picked = pickWeightedQuizExample(examples, {}, 'example-a', 0.1);

		expect(picked._id).toBe('example-b');
	});
});
