import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';

type Example = {
	sourceSentence: string;
	sourceAnswer: string;
	targetSentence: string;
	targetAnswer: string;
	targetPronunciation: string;
	targetPronunciationArpabet?: string;
};
type StoredExample = {
	_id: string;
	sourceSentenceTemplate: string;
	sourceFillText: string;
	targetSentenceTemplate: string;
	targetFillText: string;
	targetPronunciationText: string;
	targetPronunciationArpabet?: string;
	reportCount: number;
	addedAt: Date;
};
type StoredCard = {
	_id: string;
	vocaId: string;
	createdAt: Date;
	updatedAt?: Date;
	examples: StoredExample[];
};

export async function saveGeneratedExamples(
	vocas: Array<{ _id: mongoose.Types.ObjectId }>,
	payload: { items: Array<{ index: number; examples: Example[] }> }
): Promise<{ vocas: number; examples: number }> {
	const collection = mongoose.connection.collection<StoredCard>('quizcards');
	const counts = await Promise.all(
		payload.items
			.filter((item) => item.examples.length > 0)
			.map(async (item) => {
				const now = new Date();
				const vocaId = vocas[item.index]._id.toString();
				await collection.updateOne(
					{ vocaId },
					{ $setOnInsert: { _id: randomUUID(), vocaId, createdAt: now, examples: [] } },
					{ upsert: true }
				);
				let saved = 0;
				for (const example of item.examples) {
					const identity = {
						sourceSentenceTemplate: example.sourceSentence.replace(example.sourceAnswer, '{{---}}'),
						sourceFillText: example.sourceAnswer,
						targetSentenceTemplate: example.targetSentence.replace(example.targetAnswer, '{{---}}'),
						targetFillText: example.targetAnswer
					};
					const result = await collection.updateOne(
						{ vocaId, examples: { $not: { $elemMatch: identity } } },
						{
							$push: {
								examples: {
									_id: randomUUID(),
									...identity,
									targetPronunciationText: example.targetPronunciation,
									...(example.targetPronunciationArpabet
										? { targetPronunciationArpabet: example.targetPronunciationArpabet }
										: {}),
									reportCount: 0,
									addedAt: now
								}
							},
							$set: { updatedAt: now }
						}
					);
					saved += result.modifiedCount;
				}
				return saved;
			})
	);
	return {
		vocas: counts.filter((count) => count > 0).length,
		examples: counts.reduce((total, count) => total + count, 0)
	};
}
