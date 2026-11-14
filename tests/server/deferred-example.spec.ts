import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reviewMock } = vi.hoisted(() => ({ reviewMock: vi.fn() }));
vi.mock('$lib/server/example-luna-review', () => ({
	reviewExampleWithLuna: reviewMock,
	selectManualCmuPronunciation: vi.fn().mockResolvedValue({
		targetPronunciationArpabet: 'AE1 P AH0 L'
	})
}));

import { queueDeferredExample, resolveDeferredExample } from '$lib/server/deferred-example';

const input = {
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
	targetPronunciation: '애플'
};

describe('deferred examples', () => {
	const pending = { updateOne: vi.fn(), findOneAndUpdate: vi.fn() };
	const cards = { updateOne: vi.fn() };
	const vocas = { findOne: vi.fn() };
	const reports = { findOne: vi.fn() };
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		vi.spyOn(mongoose.connection, 'collection').mockImplementation(((name: string) =>
			name === 'deferredexamples'
				? pending
				: name === 'vocas'
					? vocas
					: name === 'quizreports'
						? reports
						: cards) as never);
		pending.updateOne.mockResolvedValue({ modifiedCount: 1 });
		pending.findOneAndUpdate.mockResolvedValue({
			_id: 'example-id',
			vocaId: null,
			input,
			status: 'processing'
		});
		vocas.findOne.mockResolvedValue({ _id: new mongoose.Types.ObjectId(), ...input });
		reports.findOne.mockResolvedValue(null);
		cards.updateOne.mockResolvedValue({ modifiedCount: 1 });
	});

	it('queues the same example idempotently', async () => {
		const a = await queueDeferredExample(input, null, []);
		const b = await queueDeferredExample(input, null, []);
		expect(a).toBe(b);
		expect(pending.updateOne).toHaveBeenCalledWith(
			{ _id: a },
			expect.objectContaining({
				$setOnInsert: expect.objectContaining({ status: 'pending', input })
			}),
			{ upsert: true }
		);
	});

	it('does not persist an old derived IPA value on pending records', async () => {
		const legacyInput = { ...input, targetPronunciationIpa: '/ˈæpəl/' };
		const legacyId = await queueDeferredExample(legacyInput, null, []);
		const cleanId = await queueDeferredExample(input, null, []);
		expect(legacyId).toBe(cleanId);
		expect(pending.updateOne.mock.calls[0][1].$setOnInsert.input).not.toHaveProperty(
			'targetPronunciationIpa'
		);
	});

	it('keeps an uncertain retry pending and records its evidence', async () => {
		reviewMock.mockResolvedValue({
			status: 'deferred',
			attempts: [{ model: 'test', probabilities: { pronunciation: 0.5 } }]
		});
		expect(await resolveDeferredExample('example-id', 'retry')).toBe('pending');
		expect(cards.updateOne).not.toHaveBeenCalled();
		expect(pending.updateOne).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				$set: expect.objectContaining({ status: 'pending' }),
				$push: expect.objectContaining({
					history: expect.objectContaining({ attempts: expect.any(Array) })
				})
			})
		);
	});

	it('adds an accepted retry only once using a stable example id', async () => {
		reviewMock.mockResolvedValue({
			status: 'accepted',
			attempts: [],
			targetPronunciationArpabet: 'AE1 P AH0 L'
		});
		expect(await resolveDeferredExample('example-id', 'retry')).toBe('accepted');
		expect(cards.updateOne).toHaveBeenCalledTimes(2);
		expect(cards.updateOne.mock.calls[1][0]).toMatchObject({
			'examples._id': { $ne: 'example-id' }
		});
		expect(cards.updateOne.mock.calls[1][1].$push.examples).toMatchObject({
			_id: 'example-id',
			sourceSentenceTemplate: '{{---}}를 먹었다.',
			targetPronunciationArpabet: 'AE1 P AH0 L'
		});
	});

	it('returns an unlinked item to pending when the word does not yet exist', async () => {
		vocas.findOne.mockResolvedValue(null);
		await expect(resolveDeferredExample('example-id', 'approve')).rejects.toThrow(
			'단어를 먼저 추가'
		);
		expect(pending.updateOne).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ $set: expect.objectContaining({ status: 'pending' }) })
		);
	});

	it('does not attach an example after its vocabulary definition changes', async () => {
		vocas.findOne.mockResolvedValue({
			_id: new mongoose.Types.ObjectId(),
			...input,
			targetDefinition: 'a different sense'
		});
		await expect(resolveDeferredExample('example-id', 'approve')).rejects.toThrow(
			'단어 정보가 변경'
		);
		expect(cards.updateOne).not.toHaveBeenCalled();
	});

	it('does not attach an example while a report is unresolved', async () => {
		reports.findOne.mockResolvedValue({ _id: 'report' });
		await expect(resolveDeferredExample('example-id', 'approve')).rejects.toThrow('신고 처리 중');
		expect(cards.updateOne).not.toHaveBeenCalled();
	});

	it.each([{ utilityScore: 1.9 }, { utilityScore: 4, scoreEvaluationDeferred: true }])(
		'does not attach an example to an excluded or scoring-deferred word: %o',
		async (attributes) => {
			vocas.findOne.mockResolvedValue({
				_id: new mongoose.Types.ObjectId(),
				...input,
				...attributes
			});
			await expect(resolveDeferredExample('example-id', 'approve')).rejects.toThrow(
				'활용도가 낮은'
			);
			expect(cards.updateOne).not.toHaveBeenCalled();
		}
	);
});
