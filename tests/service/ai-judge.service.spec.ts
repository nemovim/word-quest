import { describe, expect, it } from 'vitest';

import { buildQuizCardCreate } from '$lib/service/ai-judge.service';
import { LANGUAGE_CODES, QUIZ_TEMPLATE_SLOT } from '$lib/shared/types/general.type';

function makeBilingualExample(
	source: {
		fullSentence: string;
		answerSurface: string;
		pronunciationText: string;
	},
	target: {
		fullSentence: string;
		answerSurface: string;
		pronunciationText: string;
	}
) {
	return {
		texts: [
			{
				languageCode: LANGUAGE_CODES.KO,
				...source
			},
			{
				languageCode: LANGUAGE_CODES.EN,
				...target
			}
		]
	};
}

describe('ai-judge.service', () => {
	it('flattens completed bilingual sentences into stored quiz examples', () => {
		const quizCard = buildQuizCardCreate('voca-1', LANGUAGE_CODES.EN, {
			difficultyLevel: 4,
			utilityScore: 4,
			examples: [
				makeBilingualExample(
					{
						fullSentence: '그녀는 단어를 모은다.',
						answerSurface: '단어',
						pronunciationText: '단어'
					},
					{
						fullSentence: 'She collects rare words from different languages.',
						answerSurface: 'words',
						pronunciationText: '워즈'
					}
				)
			]
		});

		const example = quizCard.examples[0];

		expect(example?.sourceSentenceTemplate).toBe('그녀는 {{---}}를 모은다.');
		expect(example?.sourceFillText).toBe('단어');
		expect(example?.targetSentenceTemplate).toBe(
			`She collects rare ${QUIZ_TEMPLATE_SLOT} from different languages.`
		);
		expect(example?.targetFillText).toBe('words');
		expect(example?.targetPronunciationText).toBe('워즈');
		expect(example?.reportCount).toBe(0);
	});

	it('keeps the full Korean conjugated surface form inside the slot', () => {
		const quizCard = buildQuizCardCreate('voca-1', LANGUAGE_CODES.EN, {
			examples: [
				makeBilingualExample(
					{
						fullSentence: '그는 진심으로 사과하고 있습니다.',
						answerSurface: '사과하고',
						pronunciationText: '사과하고'
					},
					{
						fullSentence: 'He is sincerely apologizing.',
						answerSurface: 'apologizing',
						pronunciationText: '어폴러자이징'
					}
				)
			]
		});

		expect(quizCard.examples[0]?.sourceSentenceTemplate).toBe('그는 진심으로 {{---}} 있습니다.');
		expect(quizCard.examples[0]?.sourceFillText).toBe('사과하고');
	});

	it('rejects examples that are missing one side of the bilingual pair', () => {
		expect(() =>
			buildQuizCardCreate('voca-1', LANGUAGE_CODES.EN, {
				examples: [
					{
						texts: [
							{
								languageCode: LANGUAGE_CODES.EN,
								fullSentence: 'There is a word here.',
								answerSurface: 'word',
								pronunciationText: '워드'
							}
						]
					}
				]
			})
		).toThrow('Each example must contain both Korean and target-language texts.');
	});

	it('rejects pronunciationText values that are not Korean Hangul readings', () => {
		expect(() =>
			buildQuizCardCreate('voca-1', LANGUAGE_CODES.EN, {
				examples: [
					makeBilingualExample(
						{
							fullSentence: '나는 사과를 먹었다.',
							answerSurface: '사과',
							pronunciationText: '사과'
						},
						{
							fullSentence: 'I ate apple.',
							answerSurface: 'apple',
							pronunciationText: 'apple'
						}
					)
				]
			})
		).toThrow('pronunciationText must use Korean Hangul only.');
	});

	it('rejects Korean surface splits that leave verb endings outside the slot', () => {
		expect(() =>
			buildQuizCardCreate('voca-1', LANGUAGE_CODES.EN, {
				examples: [
					makeBilingualExample(
						{
							fullSentence: '그는 진심으로 사과하고 있습니다.',
							answerSurface: '사과하',
							pronunciationText: '사과하'
						},
						{
							fullSentence: 'He is sincerely apologizing.',
							answerSurface: 'apologizing',
							pronunciationText: '어폴러자이징'
						}
					)
				]
			})
		).toThrow('Korean trailing Hangul after answerSurface must be a particle sequence only.');
	});

	it('rejects Korean compound false positives', () => {
		expect(() =>
			buildQuizCardCreate('voca-1', LANGUAGE_CODES.EN, {
				examples: [
					makeBilingualExample(
						{
							fullSentence: '나는 사과나무를 봤다.',
							answerSurface: '사과',
							pronunciationText: '사과'
						},
						{
							fullSentence: 'I saw an apple tree.',
							answerSurface: 'apple tree',
							pronunciationText: '애플 트리'
						}
					)
				]
			})
		).toThrow('Korean trailing Hangul after answerSurface must be a particle sequence only.');
	});

	it('rejects answerSurface inside a larger alphabetic word', () => {
		expect(() =>
			buildQuizCardCreate('voca-1', LANGUAGE_CODES.EN, {
				examples: [
					makeBilingualExample(
						{
							fullSentence: '나는 파인애플을 좋아한다.',
							answerSurface: '파인애플',
							pronunciationText: '파인애플'
						},
						{
							fullSentence: 'I like pineapple.',
							answerSurface: 'apple',
							pronunciationText: '애플'
						}
					)
				]
			})
		).toThrow('answerSurface must not be inside a larger alphabetic word.');
	});

	it('rejects answerSurface that appears more than once', () => {
		expect(() =>
			buildQuizCardCreate('voca-1', LANGUAGE_CODES.EN, {
				examples: [
					makeBilingualExample(
						{
							fullSentence: '그는 사과를 받고 또 사과를 했다.',
							answerSurface: '사과',
							pronunciationText: '사과'
						},
						{
							fullSentence: 'He received an apology and apologized again.',
							answerSurface: 'apology',
							pronunciationText: '어폴러지'
						}
					)
				]
			})
		).toThrow('answerSurface must appear in fullSentence exactly once.');
	});
});
