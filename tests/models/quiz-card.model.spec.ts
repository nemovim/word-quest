import { describe, expect, it } from 'vitest';

import QuizCardModel from '$lib/models/quiz-card.model';

describe('quiz-card.model', () => {
	it('preserves optional pronunciation metadata on a new example', async () => {
		const document = new QuizCardModel({
			vocaId: 'voca-1',
			examples: [
				{
					_id: 'example-1',
					sourceSentenceTemplate: '{{---}}를 먹었다.',
					sourceFillText: '사과',
					targetSentenceTemplate: 'I ate an {{---}}.',
					targetFillText: 'apple',
					targetPronunciationText: '애플',
					targetPronunciationArpabet: 'AE1 P AH0 L'
				}
			]
		});
		await expect(document.validate()).resolves.toBeUndefined();
		expect(document.toObject().examples[0]).toMatchObject({
			targetPronunciationArpabet: 'AE1 P AH0 L'
		});
		expect(document.toObject().examples[0]).not.toHaveProperty('targetPronunciationIpa');
	});
	it('requires targetPronunciationText for every example', async () => {
		const document = new QuizCardModel({
			vocaId: 'voca-1',
			examples: [
				{
					_id: 'example-1',
					sourceSentenceTemplate: '나는 {{---}}를 좋아해.',
					sourceFillText: '사과',
					targetSentenceTemplate: 'I like {{---}}.',
					targetFillText: 'apples',
					targetPronunciationText: ''
				}
			]
		});

		await expect(document.validate()).rejects.toThrow();
	});
});
