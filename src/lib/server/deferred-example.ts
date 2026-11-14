import { createHash, randomUUID } from 'node:crypto';

import mongoose from 'mongoose';

import { lookupCmuPronunciations } from './cmu-pronunciation.ts';
import {
	reviewExampleWithLuna,
	selectManualCmuPronunciation,
	type ExampleReviewInput
} from './example-luna-review.ts';
import { MIN_RECOMMENDED_UTILITY_SCORE } from '../shared/types/general.type.ts';
import { decodeHtmlEntities } from '../shared/utils/html-entity.util.ts';

export type DeferredExampleInput = ExampleReviewInput;
type Attempt = Awaited<ReturnType<typeof reviewExampleWithLuna>>['attempts'];
const PROCESSING_LEASE_MS = 5 * 60 * 1000;
type StoredCard = {
	_id: string;
	vocaId: string;
	examples: Array<{
		_id: string;
		sourceSentenceTemplate: string;
		sourceFillText: string;
		targetSentenceTemplate: string;
		targetFillText: string;
		targetPronunciationText: string;
		targetPronunciationArpabet?: string;
		reportCount: number;
		addedAt: Date;
	}>;
	createdAt: Date;
	updatedAt: Date;
};
export type DeferredExample = {
	_id: string;
	vocaId: string | null;
	input: DeferredExampleInput;
	status: 'pending' | 'processing' | 'accepted' | 'rejected';
	history: Array<{ at: Date; status: string; attempts: Attempt; reason?: string }>;
	createdAt: Date;
	updatedAt: Date;
};

function pendingCollection() {
	return mongoose.connection.collection<DeferredExample>('deferredexamples');
}

export async function queueDeferredExample(
	input: DeferredExampleInput,
	vocaId: string | null,
	attempts: Attempt,
	reason?: string
) {
	// Older pending items may contain a derived IPA field; never persist it again.
	input = { ...input };
	delete (input as DeferredExampleInput & { targetPronunciationIpa?: string })
		.targetPronunciationIpa;
	const id = createHash('sha256')
		.update(JSON.stringify([vocaId, input]))
		.digest('hex');
	const now = new Date();
	await pendingCollection().updateOne(
		{ _id: id },
		{
			$setOnInsert: {
				_id: id,
				vocaId,
				input,
				status: 'pending',
				history: [{ at: now, status: 'deferred', attempts, ...(reason ? { reason } : {}) }],
				createdAt: now,
				updatedAt: now
			}
		},
		{ upsert: true }
	);
	return id;
}

export async function listDeferredExamples(limit = 100) {
	return pendingCollection()
		.find({
			$or: [
				{ status: 'pending' },
				{ status: 'processing', updatedAt: { $lt: new Date(Date.now() - PROCESSING_LEASE_MS) } }
			]
		})
		.sort({ updatedAt: 1, _id: 1 })
		.limit(limit)
		.toArray();
}

function validateInput(input: DeferredExampleInput) {
	for (const value of [
		input.sourceSentence,
		input.targetSentence,
		input.sourceAnswer,
		input.targetAnswer,
		input.targetPronunciation
	]) {
		if (!value?.trim()) throw new Error('예문과 빈칸, 발음을 모두 입력해 주세요.');
	}
	for (const [sentence, answer] of [
		[input.sourceSentence, input.sourceAnswer],
		[input.targetSentence, input.targetAnswer]
	]) {
		if (!sentence.includes(answer) || sentence.indexOf(answer) !== sentence.lastIndexOf(answer))
			throw new Error('각 빈칸은 해당 문장에 정확히 한 번 포함되어야 합니다.');
	}
}

async function saveApprovedExample(item: DeferredExample, input: DeferredExampleInput) {
	validateInput(input);
	if (
		input.targetLang === 'en' &&
		(lookupCmuPronunciations(input.targetText).missing.length ||
			lookupCmuPronunciations(input.targetAnswer).missing.length)
	)
		throw new Error('CMUdict에 없는 발음이 있어 예문을 승인할 수 없습니다.');
	const vocas = mongoose.connection.collection('vocas');
	const voca =
		item.vocaId && mongoose.isValidObjectId(item.vocaId)
			? await vocas.findOne({ _id: new mongoose.Types.ObjectId(item.vocaId) })
			: await vocas.findOne({
					sourceText: input.sourceText,
					sourceDefinition: input.sourceDefinition,
					targetText: input.targetText,
					targetDefinition: input.targetDefinition,
					targetLang: input.targetLang,
					partOfSpeech: input.partOfSpeech
				});
	if (!voca) throw new Error('연결된 단어가 없습니다. 단어를 먼저 추가한 뒤 다시 시도해 주세요.');
	if (voca.quizExcludedByReportId != null)
		throw new Error('출제 제외된 단어에는 예문을 추가할 수 없습니다.');
	if (
		voca.scoreEvaluationDeferred === true ||
		(typeof voca.utilityScore === 'number' && voca.utilityScore < MIN_RECOMMENDED_UTILITY_SCORE)
	)
		throw new Error('점수가 보류되었거나 활용도가 낮은 단어에는 예문을 추가할 수 없습니다.');
	for (const field of [
		'sourceText',
		'sourceDefinition',
		'partOfSpeech',
		'targetText',
		'targetDefinition',
		'targetLang'
	] as const) {
		if (typeof voca[field] !== 'string' || decodeHtmlEntities(voca[field]) !== input[field])
			throw new Error('단어 정보가 변경되어 보류 예문을 적용할 수 없습니다.');
	}
	const vocaId = voca._id.toString();
	const report = await mongoose.connection.collection('quizreports').findOne({
		vocaId,
		resolution: { $exists: false },
		'issues.0': { $exists: true },
		vocaSnapshot: { $exists: true },
		quizExampleSnapshot: { $exists: true }
	});
	if (report) throw new Error('신고 처리 중인 단어에는 예문을 추가할 수 없습니다.');
	const cards = mongoose.connection.collection<StoredCard>('quizcards');
	const now = new Date();
	await cards.updateOne(
		{ vocaId },
		{ $setOnInsert: { _id: randomUUID(), vocaId, examples: [], createdAt: now, updatedAt: now } },
		{ upsert: true }
	);
	await cards.updateOne(
		{ vocaId, 'examples._id': { $ne: item._id } },
		{
			$push: {
				examples: {
					_id: item._id,
					sourceSentenceTemplate: input.sourceSentence.replace(input.sourceAnswer, '{{---}}'),
					sourceFillText: input.sourceAnswer,
					targetSentenceTemplate: input.targetSentence.replace(input.targetAnswer, '{{---}}'),
					targetFillText: input.targetAnswer,
					targetPronunciationText: input.targetPronunciation,
					...(input.targetPronunciationArpabet
						? { targetPronunciationArpabet: input.targetPronunciationArpabet }
						: {}),
					reportCount: 0,
					addedAt: now
				}
			},
			$set: { updatedAt: now }
		}
	);
}

export async function resolveDeferredExample(
	id: string,
	action: 'retry' | 'approve' | 'reject',
	editedInput?: DeferredExampleInput
) {
	const collection = pendingCollection();
	const item = await collection.findOneAndUpdate(
		{
			_id: id,
			$or: [
				{ status: 'pending' },
				{ status: 'processing', updatedAt: { $lt: new Date(Date.now() - PROCESSING_LEASE_MS) } }
			]
		},
		{ $set: { status: 'processing', updatedAt: new Date() } },
		{ returnDocument: 'after' }
	);
	if (!item) throw new Error('보류 항목이 없거나 이미 처리 중입니다.');
	let attempts: Attempt = [];
	let reason: string | undefined;
	try {
		const input = { ...(editedInput ?? item.input) };
		delete (input as DeferredExampleInput & { targetPronunciationIpa?: string })
			.targetPronunciationIpa;
		let status: 'accepted' | 'rejected' | 'pending' =
			action === 'approve' ? 'accepted' : action === 'reject' ? 'rejected' : 'pending';
		if (action === 'retry') {
			const result = await reviewExampleWithLuna(input);
			if ('targetPronunciation' in result && result.targetPronunciation)
				input.targetPronunciation = result.targetPronunciation;
			if (result.targetPronunciationArpabet)
				input.targetPronunciationArpabet = result.targetPronunciationArpabet;
			attempts = result.attempts;
			reason = 'reason' in result ? result.reason : undefined;
			status = result.status === 'deferred' ? 'pending' : result.status;
		}
		if (status === 'accepted') {
			if (action === 'approve' && input.targetLang === 'en')
				Object.assign(input, await selectManualCmuPronunciation(input));
			await saveApprovedExample(item, input);
		}
		const now = new Date();
		await collection.updateOne(
			{ _id: id, status: 'processing' },
			{
				$set: { status, input, updatedAt: now },
				$push: {
					history: {
						at: now,
						status: action === 'retry' ? status : action,
						attempts,
						...(reason ? { reason } : {})
					}
				}
			}
		);
		return status;
	} catch (error) {
		const now = new Date();
		await collection.updateOne(
			{ _id: id, status: 'processing' },
			{
				$set: { status: 'pending', updatedAt: now },
				...(attempts.length ? { $push: { history: { at: now, status: 'blocked', attempts } } } : {})
			}
		);
		throw error;
	}
}
