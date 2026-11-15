import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';

import mongoose from 'mongoose';

import { createLogFile } from './log-file.ts';
import { generateExamplePronunciations } from '../src/lib/server/example-pronunciation.ts';
import { resolveGenerationModel } from '../src/lib/server/model-config.ts';

type Row = {
	_id: string;
	examples: { _id: string; targetFillText: string; targetSentenceTemplate: string };
};
type Checkpoint = {
	version: 1;
	model: string;
	logPath: string;
	total: number;
	attempted: number;
	saved: number;
	deferred: number;
	batch: number;
	cursor?: { card: string; example: string };
	completed: boolean;
};
const missing = { $eq: [{ $ifNull: ['$examples.targetPronunciationArpabet', ''] }, ''] };

function pipeline(cursor?: Checkpoint['cursor']): mongoose.PipelineStage[] {
	return [
		{
			$match: {
				...(cursor ? { _id: { $gte: cursor.card } } : {}),
				examples: {
					$elemMatch: {
						$or: [
							{ targetPronunciationArpabet: { $exists: false } },
							{ targetPronunciationArpabet: null },
							{ targetPronunciationArpabet: '' }
						]
					}
				}
			}
		},
		{ $unwind: '$examples' },
		{
			$match: {
				$expr: missing,
				...(cursor
					? {
							$or: [
								{ _id: { $gt: cursor.card } },
								{ _id: cursor.card, 'examples._id': { $gt: cursor.example } }
							]
						}
					: {})
			}
		},
		{ $sort: { _id: 1, 'examples._id': 1 } },
		{
			$lookup: {
				from: 'vocas',
				let: {
					id: { $convert: { input: '$vocaId', to: 'objectId', onError: null, onNull: null } }
				},
				pipeline: [
					{ $match: { targetLang: 'en', $expr: { $eq: ['$_id', '$$id'] } } },
					{ $project: { _id: 1 } }
				],
				as: 'englishVoca'
			}
		},
		{ $match: { 'englishVoca.0': { $exists: true } } },
		{ $project: { _id: 1, examples: 1 } }
	];
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length && (args.length !== 2 || args[0] !== 'resume'))
		throw new Error('Usage: npm run vocas:pronunciations -- [resume <checkpoint>]');
	const resumePath = args[0] === 'resume' ? args[1] : undefined;
	const previous = resumePath
		? (JSON.parse(await readFile(resumePath, 'utf8')) as Checkpoint)
		: undefined;
	if (
		previous &&
		(previous.version !== 1 ||
			!previous.logPath ||
			!previous.model ||
			!Number.isSafeInteger(previous.total) ||
			!Number.isSafeInteger(previous.attempted) ||
			(previous.cursor &&
				(typeof previous.cursor.card !== 'string' || typeof previous.cursor.example !== 'string')))
	)
		throw new Error('Invalid pronunciation checkpoint.');
	if (previous?.completed) throw new Error('This pronunciation run is already complete.');
	const uri = process.env.MONGO_URI?.trim();
	if (!uri) throw new Error('MONGO_URI is required.');
	await mongoose.connect(uri);
	try {
		const cards = mongoose.connection.collection('quizcards');
		const model = previous?.model ?? resolveGenerationModel(process.env.OPENROUTER_MODEL);
		const logPath =
			previous?.logPath ??
			(await createLogFile('example-pronunciation', 'pronunciation', new Date(), ''));
		const checkpointPath = resumePath ?? `${logPath}.checkpoint.json`;
		const count = previous
			? undefined
			: await cards
					.aggregate<{ count: number }>([...pipeline(), { $count: 'count' }], {
						allowDiskUse: true
					})
					.toArray();
		const state: Checkpoint = previous ?? {
			version: 1,
			model,
			logPath,
			total: count?.[0]?.count ?? 0,
			attempted: 0,
			saved: 0,
			deferred: 0,
			batch: 0,
			completed: false
		};
		const save = async () => {
			const temp = `${checkpointPath}.${process.pid}.tmp`;
			await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
			await rename(temp, checkpointPath);
		};
		await save();
		console.log(
			`진행: ${state.attempted}/${state.total} 예문 · 저장 ${state.saved} · 보류 ${state.deferred} · 이어하기 파일: ${checkpointPath}`
		);
		while (true) {
			const rows = await cards
				.aggregate<Row>([...pipeline(state.cursor), { $limit: 5 }], { allowDiskUse: true })
				.toArray();
			if (!rows.length) break;
			const results = await generateExamplePronunciations(
				rows.map(({ examples }) => ({
					answer: examples.targetFillText,
					sentence: examples.targetSentenceTemplate.replace('{{---}}', examples.targetFillText)
				})),
				model
			);
			for (let i = 0; i < rows.length; i++) {
				const row = rows[i],
					result = results[i];
				if (result.status === 'deferred') {
					await appendFile(
						`${logPath}.deferred.jsonl`,
						JSON.stringify({
							cardId: row._id,
							exampleId: row.examples._id,
							answer: row.examples.targetFillText,
							reason: result.reason
						}) + '\n',
						'utf8'
					);
					state.deferred++;
				} else {
					const written = await cards.updateOne(
						{
							_id: row._id,
							examples: {
								$elemMatch: {
									_id: row.examples._id,
									targetFillText: row.examples.targetFillText,
									targetSentenceTemplate: row.examples.targetSentenceTemplate,
									$or: [
										{ targetPronunciationArpabet: { $exists: false } },
										{ targetPronunciationArpabet: null },
										{ targetPronunciationArpabet: '' }
									]
								}
							}
						},
						{
							$set: {
								'examples.$.targetPronunciationArpabet': result.arpabet,
								'examples.$.targetPronunciationText': result.hangul,
								updatedAt: new Date()
							}
						}
					);
					state.saved += written.modifiedCount;
				}
				state.attempted++;
				state.cursor = { card: row._id, example: row.examples._id };
				await save();
			}
			state.batch++;
			await save();
			console.log(
				`[배치 ${state.batch}] 진행 ${state.attempted}/${state.total} (${state.total ? ((100 * state.attempted) / state.total).toFixed(1) : '0.0'}%) · 저장 ${state.saved} · 보류 ${state.deferred}`
			);
		}
		state.completed = true;
		await save();
		console.log(
			`[완료] 처리 ${state.attempted}/${state.total} · 저장 ${state.saved} · 보류 ${state.deferred} · 보류 목록 ${logPath}.deferred.jsonl`
		);
	} catch (error) {
		console.error(`발음 처리가 중단되었습니다. 출력된 이어하기 파일로 재실행하세요.`);
		throw error;
	} finally {
		await mongoose.disconnect();
	}
}

await main();
