import { afterEach, expect, it, vi } from 'vitest';

import {
	reviewExampleWithLuna,
	reviewExamplesWithLuna,
	selectManualCmuPronunciation
} from '$lib/server/example-luna-review';

const example = {
	sourceText: '사과',
	sourceDefinition: '과일',
	partOfSpeech: 'noun',
	targetText: 'apple',
	targetDefinition: 'fruit',
	targetLang: 'en',
	sourceSentence: '사과를 먹었다.',
	sourceAnswer: '사과',
	targetSentence: 'I ate an apple.',
	targetAnswer: 'apple',
	targetPronunciation: '기존발음'
};
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

function makeFetch(items: unknown[]) {
	vi.stubEnv('OPENROUTER_API_KEY', 'test');
	return vi.fn().mockResolvedValue(
		new Response(
			JSON.stringify({
				model: 'test/luna',
				choices: [{ message: { content: JSON.stringify({ items }) } }],
				usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 }
			})
		)
	);
}

it('defers missing dictionary entries without making an API call', async () => {
	const fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	expect(await reviewExampleWithLuna({ ...example, targetText: 'zzzqvzz' })).toMatchObject({
		status: 'deferred',
		reason: 'cmudict_missing:zzzqvzz'
	});
	expect(fetchMock).not.toHaveBeenCalled();
});

it('sends both answer spans and dictionary candidates, then uses the generated Hangul', async () => {
	const fetchMock = makeFetch([{ index: 0, verdict: 'accept', choices: [0], hangul: '클로서' }]);
	vi.stubGlobal('fetch', fetchMock);
	const result = await reviewExampleWithLuna({
		...example,
		targetText: 'close',
		targetAnswer: 'closer',
		sourceAnswer: '더 가까워졌다',
		sourceSentence: '우리는 더 가까워졌다.',
		targetSentence: 'We became closer.'
	});
	expect(result).toMatchObject({
		status: 'accepted',
		targetPronunciation: '클로서',
		targetPronunciationArpabet: 'K L OW1 S ER0'
	});
	const [url, init] = fetchMock.mock.calls[0];
	expect(url).toContain('/chat/completions');
	const body = JSON.parse(init.body);
	const sent = JSON.parse(body.messages[1].content)[0];
	expect(sent).toMatchObject({
		sourceAnswer: '더 가까워졌다',
		targetAnswer: 'closer',
		words: [
			{ word: 'closer', candidates: expect.arrayContaining(['K L OW1 S ER0', 'K L OW1 Z ER0']) }
		]
	});
	expect(sent).not.toHaveProperty('targetPronunciation');
	expect(body.messages[0].content).toContain('sourceAnswer and targetAnswer');
});

it('handles multiple examples in one call and maps each verdict independently', async () => {
	const fetchMock = makeFetch([
		{ index: 1, verdict: 'reject', choices: [], hangul: '' },
		{ index: 0, verdict: 'accept', choices: [0], hangul: '애플' }
	]);
	vi.stubGlobal('fetch', fetchMock);
	const withIndex = { ...example, index: 7 };
	const results = await reviewExamplesWithLuna([withIndex, withIndex]);
	expect(results.map((r) => r.status)).toEqual(['accepted', 'rejected']);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	const input = JSON.parse(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content);
	expect(input.map((item: { index: number }) => item.index)).toEqual([0, 1]);
	expect(results[0].attempts[0].usage?.cost).toBe(0.001);
	expect(results[1].attempts[0].usage).toBeUndefined();
});

it('keeps absent dictionary items deferred while processing other items', async () => {
	const fetchMock = makeFetch([{ index: 1, verdict: 'accept', choices: [0], hangul: '애플' }]);
	vi.stubGlobal('fetch', fetchMock);
	const results = await reviewExamplesWithLuna([{ ...example, targetText: 'zzzqvzz' }, example]);
	expect(results.map((r) => r.status)).toEqual(['deferred', 'accepted']);
	expect(JSON.parse(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content)).toHaveLength(
		1
	);
});

it('defers uncertain or malformed pronunciation choices instead of saving them', async () => {
	for (const item of [
		{ index: 0, verdict: 'uncertain', choices: [], hangul: '' },
		{ index: 0, verdict: 'accept', choices: [-1], hangul: '애플' },
		{ index: 0, verdict: 'accept', choices: [0], hangul: 'apple' }
	]) {
		vi.stubGlobal('fetch', makeFetch([item]));
		expect(await reviewExampleWithLuna(example)).toMatchObject({
			status: 'deferred',
			accepted: false
		});
	}
});

it('rejects incomplete or duplicate model output rather than saving an unreviewed example', async () => {
	vi.stubGlobal(
		'fetch',
		makeFetch([
			{ index: 0, verdict: 'accept', choices: [0], hangul: '애플' },
			{ index: 0, verdict: 'accept', choices: [0], hangul: '애플' }
		])
	);
	await expect(reviewExamplesWithLuna([example, example])).rejects.toThrow(
		'Invalid example review item'
	);
});

it('generates the pronunciation during review for non-English examples', async () => {
	const fetchMock = makeFetch([{ index: 0, verdict: 'accept', choices: [], hangul: '링고' }]);
	vi.stubGlobal('fetch', fetchMock);
	expect(
		await reviewExampleWithLuna({
			...example,
			targetLang: 'ja',
			targetText: 'りんご',
			targetPronunciation: ''
		})
	).toMatchObject({ status: 'accepted', targetPronunciation: '링고' });
	const sent = JSON.parse(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content)[0];
	expect(sent).not.toHaveProperty('targetPronunciation');
});

it('defers a non-English example when review does not produce Hangul', async () => {
	vi.stubGlobal('fetch', makeFetch([{ index: 0, verdict: 'accept', choices: [], hangul: '' }]));
	expect(await reviewExampleWithLuna({ ...example, targetLang: 'ja' })).toMatchObject({
		status: 'deferred',
		reason: 'pronunciation_uncertain'
	});
});

it('resolves an ambiguous pronunciation during manual approval without changing the Hangul', async () => {
	vi.stubEnv('OPENROUTER_API_KEY', 'test');
	const fetchMock = vi
		.fn()
		.mockResolvedValue(
			new Response(JSON.stringify({ choices: [{ message: { content: '{"choices":[1]}' } }] }))
		);
	vi.stubGlobal('fetch', fetchMock);
	expect(
		await selectManualCmuPronunciation({
			...example,
			targetText: 'read',
			targetAnswer: 'read',
			targetSentence: 'I read every day.'
		})
	).toEqual({ targetPronunciationArpabet: 'R IY1 D' });
	expect(fetchMock).toHaveBeenCalledTimes(1);
});
