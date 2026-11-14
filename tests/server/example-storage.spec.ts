/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import { afterEach, expect, it, vi } from 'vitest';

import { saveGeneratedExamples } from '../../scripts/example-storage';

afterEach(() => vi.restoreAllMocks());

it('appends only new examples without replacing existing ones', async () => {
	const existing = {
		sourceSentenceTemplate: '{{---}}를 먹었다.',
		sourceFillText: '사과',
		targetSentenceTemplate: 'I ate an {{---}}.',
		targetFillText: 'apple'
	};
	const stored = [existing];
	const updateOne = vi.fn(async (_filter: any, update: any) => {
		if (update.$setOnInsert) return { modifiedCount: 0 };
		const next = update.$push.examples;
		if (
			stored.some((item) =>
				Object.keys(existing).every((key) => item[key as keyof typeof existing] === next[key])
			)
		)
			return { modifiedCount: 0 };
		stored.push(next);
		return { modifiedCount: 1 };
	});
	vi.spyOn(mongoose.connection, 'collection').mockReturnValue({ updateOne } as never);
	const vocas = [{ _id: new mongoose.Types.ObjectId() }];
	const payload = {
		items: [
			{
				index: 0,
				examples: [
					{
						sourceSentence: '사과를 먹었다.',
						sourceAnswer: '사과',
						targetSentence: 'I ate an apple.',
						targetAnswer: 'apple',
						targetPronunciation: '애플'
					},
					{
						sourceSentence: '사과를 샀다.',
						sourceAnswer: '사과',
						targetSentence: 'I bought an apple.',
						targetAnswer: 'apple',
						targetPronunciation: '애플',
						targetPronunciationArpabet: 'AE1 P AH0 L'
					}
				]
			}
		]
	};
	expect(await saveGeneratedExamples(vocas, payload)).toEqual({ vocas: 1, examples: 1 });
	expect(stored).toHaveLength(2);
	expect(updateOne.mock.calls[2][1].$push.examples).toMatchObject({
		targetPronunciationArpabet: 'AE1 P AH0 L'
	});
	expect(updateOne.mock.calls[2][1].$push.examples).not.toHaveProperty('targetPronunciationIpa');
	expect(stored[0]).toEqual(existing);
	expect(updateOne.mock.calls.every(([, update]) => !('examples' in (update.$set ?? {})))).toBe(
		true
	);
	expect(await saveGeneratedExamples(vocas, payload)).toEqual({ vocas: 0, examples: 0 });
});
