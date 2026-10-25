import { describe, expect, it } from 'vitest';

import QuizCardModel from '$lib/models/quiz-card.model';

describe('quiz-card.model', () => {
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
