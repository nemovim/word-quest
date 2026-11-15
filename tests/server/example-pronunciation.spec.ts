import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateExamplePronunciations } from '../../src/lib/server/example-pronunciation.ts';

describe('existing example pronunciation', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});
	it('selects a dictionary candidate and returns the corresponding Hangul', async () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'test');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({ items: [{ index: 0, choices: [0], hangul: '헬로' }] })
							}
						}
					]
				})
			}))
		);
		const result = await generateExamplePronunciations(
			[{ sentence: 'Hello!', answer: 'hello' }],
			'test-model'
		);
		expect(result[0]).toMatchObject({ status: 'ok', hangul: '헬로' });
		if (result[0].status === 'ok') expect(result[0].arpabet).toMatch(/HH/);
	});
	it('defers words absent from the dictionary without an API call', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const result = await generateExamplePronunciations(
			[{ sentence: 'xyzzyqz', answer: 'xyzzyqz' }],
			'test-model'
		);
		expect(result[0]).toMatchObject({
			status: 'deferred',
			reason: expect.stringContaining('cmudict_missing:')
		});
		expect(fetch).not.toHaveBeenCalled();
	});
	it('defers an uncertain selection', async () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'test');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({ items: [{ index: 0, choices: [-1], hangul: '헬로' }] })
							}
						}
					]
				})
			}))
		);
		expect(
			await generateExamplePronunciations([{ sentence: 'hello', answer: 'hello' }], 'test-model')
		).toEqual([{ status: 'deferred', reason: 'pronunciation_uncertain' }]);
	});
});
