import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendOpenRouterJsonMock, scoreVocaWithDecisionModelMock, reviewExampleWithLunaMock } =
	vi.hoisted(() => ({
		sendOpenRouterJsonMock: vi.fn(),
		scoreVocaWithDecisionModelMock: vi.fn(),
		reviewExampleWithLunaMock: vi.fn()
	}));

vi.mock('$lib/server/openrouter', () => ({
	sendOpenRouterJson: sendOpenRouterJsonMock
}));
vi.mock('$lib/server/decision-voca-scoring', () => ({
	scoreVocaWithDecisionModel: scoreVocaWithDecisionModelMock
}));
vi.mock('$lib/server/example-luna-review', () => ({
	reviewExamplesWithLuna: (inputs: unknown[]) =>
		Promise.all(inputs.map(() => reviewExampleWithLunaMock()))
}));
vi.mock('$lib/server/deferred-example', () => ({
	queueDeferredExample: vi.fn().mockResolvedValue('pending-id')
}));

import {
	buildQuizCardCreate,
	generateQuizCardSeed,
	validateCustomVocaInput
} from '$lib/service/ai-judge.service';
import { LANGUAGE_CODES } from '$lib/shared/types/general.type';
import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';

const HANGUL_APPLE = '애플';
const HANGUL_FRUIT = '사과';

function makeValidSeed() {
	return {
		difficultyLevel: 4,
		utilityScore: 4,
		examples: [
			{
				texts: [
					{
						languageCode: LANGUAGE_CODES.KO,
						fullSentence: '내가 어제 사과를 적었다.',
						answerSurface: HANGUL_FRUIT
					},
					{
						languageCode: LANGUAGE_CODES.EN,
						fullSentence: 'I wrote apple yesterday.',
						answerSurface: 'apple'
					}
				]
			}
		]
	};
}

describe('ai-judge.service generate prompt', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sendOpenRouterJsonMock.mockResolvedValue(makeValidSeed());
		scoreVocaWithDecisionModelMock.mockResolvedValue({ difficultyLevel: 2, utilityScore: 5 });
		reviewExampleWithLunaMock.mockResolvedValue({
			accepted: true,
			targetPronunciation: HANGUL_APPLE
		});
	});

	it('rejects examples when Luna does not approve them', async () => {
		reviewExampleWithLunaMock.mockResolvedValue({ accepted: false });
		await expect(
			generateQuizCardSeed({
				sourceText: '사과',
				sourceDefinition: '과일',
				partOfSpeech: PARTS_OF_SPEECH.NOUN,
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'apple',
				targetDefinition: 'fruit'
			})
		).rejects.toThrow('예문 생성에 실패했어요.');
		expect(scoreVocaWithDecisionModelMock).not.toHaveBeenCalled();
	});

	it('holds the draft when the example review remains uncertain', async () => {
		reviewExampleWithLunaMock.mockResolvedValue({ accepted: false, status: 'deferred' });
		await expect(
			generateQuizCardSeed({
				sourceText: '사과',
				sourceDefinition: '과일',
				partOfSpeech: PARTS_OF_SPEECH.NOUN,
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'apple',
				targetDefinition: 'fruit'
			})
		).rejects.toThrow('확실');
		expect(scoreVocaWithDecisionModelMock).not.toHaveBeenCalled();
	});

	it('uses decision-model scores for a generated vocabulary item', async () => {
		const input = {
			sourceText: '사과',
			sourceDefinition: '과일',
			partOfSpeech: PARTS_OF_SPEECH.NOUN,
			targetLang: LANGUAGE_CODES.EN,
			targetText: 'apple',
			targetDefinition: 'a kind of fruit'
		};
		const seed = await generateQuizCardSeed(input);
		expect(scoreVocaWithDecisionModelMock).toHaveBeenCalledWith(input);
		expect(seed).toMatchObject({ difficultyLevel: 2, utilityScore: 5 });
	});

	it('keeps the selected pronunciation in the generated seed and saved card payload', async () => {
		reviewExampleWithLunaMock.mockResolvedValue({
			accepted: true,
			targetPronunciation: '애플',
			targetPronunciationArpabet: 'AE1 P AH0 L'
		});
		const input = {
			sourceText: '사과',
			sourceDefinition: '과일',
			partOfSpeech: PARTS_OF_SPEECH.NOUN,
			targetLang: LANGUAGE_CODES.EN,
			targetText: 'apple',
			targetDefinition: 'fruit'
		};
		const seed = await generateQuizCardSeed(input);
		expect(buildQuizCardCreate('voca-id', LANGUAGE_CODES.EN, seed).examples[0]).toMatchObject({
			targetPronunciationArpabet: 'AE1 P AH0 L'
		});
	});

	it('includes source and target definitions and requests fullSentence + answerSurface', async () => {
		await generateQuizCardSeed({
			sourceText: 'source-word',
			sourceDefinition: 'source definition',
			partOfSpeech: PARTS_OF_SPEECH.NOUN,
			targetLang: LANGUAGE_CODES.EN,
			targetText: 'apple',
			targetDefinition: 'a kind of fruit'
		});

		const [request] = sendOpenRouterJsonMock.mock.calls[0] ?? [];
		const userPrompt = request?.messages[1]?.content ?? '';
		const textProperties =
			request?.schema?.properties?.examples?.items?.properties?.texts?.items?.properties;

		expect(request?.schema?.required).toEqual(['difficultyLevel', 'utilityScore', 'examples']);
		expect(textProperties?.fullSentence).toEqual({ type: 'string' });
		expect(textProperties?.answerSurface).toEqual({ type: 'string' });
		expect(textProperties?.pronunciationText).toBeUndefined();
		expect(request?.messages[0]?.content).toContain('Return fullSentence with no {{---}}.');
		expect(request?.messages[0]?.content).toContain(
			'Return answerSurface as the exact substring to hide from fullSentence.'
		);
		expect(request?.messages[0]?.content).toContain(
			'Every sentence MUST be grammatically correct and internally coherent'
		);
		expect(request?.messages[0]?.content).toContain(
			'Every sentence MUST also sound natural and idiomatic to a modern native speaker'
		);
		expect(request?.messages[0]?.content).toContain(
			'Use common collocations and a representative real-world use'
		);
		expect(request?.messages[0]?.content).toContain('"three games", NEVER "three game"');
		expect(request?.messages[0]?.content).toContain(
			'prefer natural surface-form variety when the lexeme naturally supports it'
		);
		expect(request?.messages[0]?.content).toContain(
			'for every other known sourcePartOfSpeech, preserve sourceText exactly'
		);
		expect(request?.messages[0]?.content).toContain(
			'Korean noun answerSurface MUST exclude trailing particles'
		);
		expect(request?.messages[0]?.content).toContain(
			'rewrite the whole context instead of replacing the headword'
		);
		expect(request?.messages[0]?.content).not.toContain('pronunciationText');
		expect(userPrompt).toContain('sourceText:source-word');
		expect(userPrompt).toContain('sourceDefinition:source definition');
		expect(userPrompt).toContain('sourcePartOfSpeech:noun');
		expect(userPrompt).toContain('targetText:apple');
		expect(userPrompt).toContain('targetDefinition:a kind of fruit');
	});

	it('applies utilityScore 0 to the initial generation path too', async () => {
		sendOpenRouterJsonMock.mockResolvedValue({
			difficultyLevel: 6,
			utilityScore: 0,
			examples: []
		});

		const seed = await generateQuizCardSeed({
			sourceText: 'source-word',
			sourceDefinition: 'source definition',
			partOfSpeech: PARTS_OF_SPEECH.NOUN,
			targetLang: LANGUAGE_CODES.EN,
			targetText: 'apple',
			targetDefinition: 'a kind of fruit'
		});

		expect(seed.utilityScore).toBe(0);
		expect(seed.examples).toEqual([]);
	});

	it('retries when every generated example is invalid', async () => {
		const invalidSeed = makeValidSeed();
		invalidSeed.examples[0].texts[1].answerSurface = 'missing';
		sendOpenRouterJsonMock.mockResolvedValue(invalidSeed);

		await expect(
			generateQuizCardSeed({
				sourceText: 'fruit-source',
				sourceDefinition: 'fruit definition',
				partOfSpeech: PARTS_OF_SPEECH.NOUN,
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'apple',
				targetDefinition: 'a kind of fruit'
			})
		).rejects.toThrow('예문 생성에 실패했어요.');

		expect(sendOpenRouterJsonMock).toHaveBeenCalledTimes(2);
	});

	it('keeps valid examples when another generated example has an invalid answer span', async () => {
		const validSeed = makeValidSeed();
		const invalidExample = structuredClone(validSeed.examples[0]!);
		invalidExample.texts[1].answerSurface = 'missing';
		sendOpenRouterJsonMock.mockResolvedValueOnce({
			...validSeed,
			examples: [...validSeed.examples, invalidExample]
		});

		const seed = await generateQuizCardSeed({
			sourceText: 'fruit-source',
			sourceDefinition: 'fruit definition',
			partOfSpeech: PARTS_OF_SPEECH.NOUN,
			targetLang: LANGUAGE_CODES.EN,
			targetText: 'apple',
			targetDefinition: 'a kind of fruit'
		});

		expect(sendOpenRouterJsonMock).toHaveBeenCalledOnce();
		expect(seed.examples).toHaveLength(1);
		expect(seed.examples[0]?.texts[1]?.pronunciationText).toBe(HANGUL_APPLE);
	});

	it('validates and cleans a custom voca before generating examples', async () => {
		sendOpenRouterJsonMock.mockResolvedValueOnce({
			isValid: true,
			rejectionMessage: '',
			matchingOriginKey: 'krdict:1:1:en:go',
			sourceDefinition: 'move to another place',
			partOfSpeech: PARTS_OF_SPEECH.VERB,
			targetDefinition: 'to move from one place to another'
		});

		await validateCustomVocaInput(
			{
				sourceText: 'source-word',
				targetLang: LANGUAGE_CODES.EN,
				targetText: 'go',
				meaningHint: 'move to another place'
			},
			[
				{
					_id: 'voca-1',
					originKey: 'krdict:1:1:en:go',
					targetText: 'go',
					sourceDefinition: 'move to another place',
					targetDefinition: 'to move from one place to another'
				}
			]
		);

		const [request] = sendOpenRouterJsonMock.mock.calls[0] ?? [];
		const userPrompt = request?.messages[1]?.content ?? '';

		expect(request?.schema?.required).toEqual([
			'isValid',
			'rejectionMessage',
			'matchingOriginKey',
			'sourceDefinition',
			'partOfSpeech',
			'targetDefinition'
		]);
		expect(request?.messages[0]?.content).toContain('Validate a user-proposed');
		expect(request?.messages[0]?.content).toContain('If uncertain, reject it');
		expect(userPrompt).toContain('sourceText:source-word');
		expect(userPrompt).toContain('targetText:go');
		expect(userPrompt).toContain('meaningHint:move to another place');
		expect(userPrompt).toContain('krdict:1:1:en:go');
	});

	it('rejects an AI matching key that was not supplied by the server', async () => {
		sendOpenRouterJsonMock.mockResolvedValueOnce({
			isValid: true,
			rejectionMessage: '',
			matchingOriginKey: 'invented:key',
			sourceDefinition: '미안함을 표현함.',
			partOfSpeech: PARTS_OF_SPEECH.VERB,
			targetDefinition: 'to express regret'
		});

		await expect(
			validateCustomVocaInput(
				{
					sourceText: '사과하다',
					targetLang: LANGUAGE_CODES.EN,
					targetText: 'apologize',
					meaningHint: '미안함을 표현하다'
				},
				[]
			)
		).rejects.toThrow('matchingOriginKey is invalid');

		expect(sendOpenRouterJsonMock).toHaveBeenCalledOnce();
	});
});
