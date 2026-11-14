import { appendFile } from 'node:fs/promises';

import mongoose from 'mongoose';

import { nextBatchSize, readScoringOptions, scoreFilter, type ScoreMode } from './batch-options.ts';
import { createLogFile } from './log-file.ts';
import {
	scoreVocaWithDecisionModel,
	UncertainVocaScoreError
} from '../src/lib/server/decision-voca-scoring.ts';
import { decodeHtmlEntities } from '../src/lib/shared/utils/html-entity.util.ts';

const BATCH_SIZE = 100;

type VocaForScoring = {
	_id: mongoose.Types.ObjectId;
	originKey: string;
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: string;
	targetText: string;
	targetDefinition: string;
	targetLang: string;
	difficultyLevel?: number | null;
	utilityScore?: number | null;
	scoreEvaluatedAt?: Date | null;
	scoreEvaluationDeferred?: boolean;
};

type Score = {
	id: string;
	difficultyLevel: number;
	koreanUsage: number;
	englishUsage: number;
	isValid: number;
	utilityScore: number;
	previous: VocaForScoring;
};

type ScoreDistribution = Record<string, number>;

type RunStatistics = {
	batches: number;
	headwords: number;
	senses: number;
	difficultyScoredSenses: number;
	difficultyLevels: ScoreDistribution;
	utilityScores: ScoreDistribution;
};

function requireEnvironment(name: 'MONGO_URI'): string {
	const value = process.env[name]?.trim();

	if (value == null || value === '') {
		throw new Error(`${name} is required.`);
	}

	return value;
}

async function loadBatch(
	mode: ScoreMode,
	afterId: mongoose.Types.ObjectId | undefined,
	batchLimit: number
): Promise<VocaForScoring[]> {
	const collection = mongoose.connection.collection<VocaForScoring>('vocas');
	const batchFilter = {
		...scoreFilter(mode),
		...(afterId ? { _id: { $gt: afterId } } : {})
	};
	return collection
		.find(batchFilter)
		.sort({ _id: 1 })
		.limit(batchLimit)
		.project<VocaForScoring>({
			originKey: 1,
			sourceText: 1,
			sourceDefinition: 1,
			partOfSpeech: 1,
			targetLang: 1,
			targetText: 1,
			targetDefinition: 1,
			difficultyLevel: 1,
			utilityScore: 1,
			scoreEvaluatedAt: 1,
			scoreEvaluationDeferred: 1
		})
		.toArray();
}

async function requestScores(vocas: VocaForScoring[]) {
	const scores: Score[] = [];
	const deferred: Array<{
		id: string;
		sourceText: string;
		targetText: string;
		attempts: UncertainVocaScoreError['attempts'];
	}> = [];
	// Bound concurrency so a large database run does not flood the provider.
	for (let index = 0; index < vocas.length; index += 5) {
		const batch = vocas.slice(index, index + 5);
		const scored = await Promise.all(
			batch.map(async (voca) => {
				try {
					const result = await scoreVocaWithDecisionModel({
						sourceText: decodeHtmlEntities(voca.sourceText),
						sourceDefinition: decodeHtmlEntities(voca.sourceDefinition),
						partOfSpeech: voca.partOfSpeech,
						targetLang: voca.targetLang,
						targetText: decodeHtmlEntities(voca.targetText),
						targetDefinition: decodeHtmlEntities(voca.targetDefinition)
					});
					return { id: voca._id.toString(), previous: voca, ...result };
				} catch (error) {
					if (!(error instanceof UncertainVocaScoreError)) throw error;
					deferred.push({
						id: voca._id.toString(),
						sourceText: voca.sourceText,
						targetText: voca.targetText,
						attempts: error.attempts
					});
					return null;
				}
			})
		);
		scores.push(...scored.filter((item): item is NonNullable<typeof item> => item !== null));
	}
	return { scores, deferred };
}

async function saveScores(scores: Score[], mode: ScoreMode): Promise<number> {
	if (scores.length === 0) return 0;
	const collection = mongoose.connection.collection('vocas');
	const scoreEvaluatedAt = new Date();
	const result = await collection.bulkWrite(
		scores.map((score) => ({
			updateOne: {
				filter: {
					_id: new mongoose.Types.ObjectId(score.id),
					...scoreFilter(mode),
					sourceText: score.previous.sourceText,
					sourceDefinition: score.previous.sourceDefinition,
					partOfSpeech: score.previous.partOfSpeech,
					targetLang: score.previous.targetLang,
					targetText: score.previous.targetText,
					targetDefinition: score.previous.targetDefinition,
					difficultyLevel:
						score.previous.difficultyLevel === undefined
							? { $exists: false }
							: score.previous.difficultyLevel,
					utilityScore:
						score.previous.utilityScore === undefined
							? { $exists: false }
							: score.previous.utilityScore,
					scoreEvaluatedAt:
						score.previous.scoreEvaluatedAt === undefined
							? { $exists: false }
							: score.previous.scoreEvaluatedAt,
					scoreEvaluationDeferred:
						score.previous.scoreEvaluationDeferred === undefined
							? { $exists: false }
							: score.previous.scoreEvaluationDeferred
				},
				update: {
					$set: {
						difficultyLevel: score.difficultyLevel,
						utilityScore: score.utilityScore,
						scoreReviewCount: mode === 'zero' ? 2 : 1,
						scoreEvaluatedAt,
						scoreEvaluationDeferred: false
					}
				}
			}
		}))
	);

	return result.modifiedCount;
}

async function markDeferred(vocas: VocaForScoring[], ids: Set<string>): Promise<void> {
	const selected = vocas.filter((voca) => ids.has(voca._id.toString()));
	if (selected.length === 0) return;
	const result = await mongoose.connection.collection('vocas').bulkWrite(
		selected.map((voca) => ({
			updateOne: {
				filter: {
					_id: voca._id,
					sourceText: voca.sourceText,
					sourceDefinition: voca.sourceDefinition,
					partOfSpeech: voca.partOfSpeech,
					targetLang: voca.targetLang,
					targetText: voca.targetText,
					targetDefinition: voca.targetDefinition,
					difficultyLevel:
						voca.difficultyLevel === undefined ? { $exists: false } : voca.difficultyLevel,
					utilityScore: voca.utilityScore === undefined ? { $exists: false } : voca.utilityScore,
					scoreEvaluatedAt:
						voca.scoreEvaluatedAt === undefined ? { $exists: false } : voca.scoreEvaluatedAt,
					scoreEvaluationDeferred:
						voca.scoreEvaluationDeferred === undefined
							? { $exists: false }
							: voca.scoreEvaluationDeferred
				},
				update: { $set: { scoreEvaluationDeferred: true } }
			}
		}))
	);
	if (result.matchedCount !== selected.length)
		throw new Error('Some deferred vocabulary records changed during scoring.');
}

function createDistribution(minimum: number, maximum: number): ScoreDistribution {
	return Object.fromEntries(
		Array.from({ length: maximum - minimum + 1 }, (_, index) => [String(minimum + index), 0])
	);
}

function createRunStatistics(): RunStatistics {
	return {
		batches: 0,
		headwords: 0,
		senses: 0,
		difficultyScoredSenses: 0,
		difficultyLevels: createDistribution(1, 10),
		utilityScores: createDistribution(0, 5)
	};
}

function addScoresToStatistics(statistics: RunStatistics, scores: Score[]): void {
	statistics.senses += scores.length;

	for (const score of scores) {
		statistics.utilityScores[String(Math.round(score.utilityScore))] += 1;

		if (score.utilityScore > 0) {
			statistics.difficultyScoredSenses += 1;
			statistics.difficultyLevels[String(Math.round(score.difficultyLevel))] += 1;
		}
	}
}

function formatDistribution(distribution: ScoreDistribution): string {
	return Object.entries(distribution)
		.map(([score, count]) => `${score}=${count.toLocaleString()}`)
		.join(', ');
}

function formatStatisticsSection(
	title: string,
	statistics: Pick<
		RunStatistics,
		'headwords' | 'senses' | 'difficultyScoredSenses' | 'difficultyLevels' | 'utilityScores'
	>
): string {
	return [
		`[${title}]`,
		`표제어: ${statistics.headwords.toLocaleString()}개`,
		`뜻: ${statistics.senses.toLocaleString()}개`,
		`utilityScore (정수 구간): ${formatDistribution(statistics.utilityScores)}`,
		`difficultyLevel (정수 구간, utilityScore 1-5, ${statistics.difficultyScoredSenses.toLocaleString()}개): ${formatDistribution(statistics.difficultyLevels)}`
	].join('\n');
}

async function createReportFile(mode: ScoreMode): Promise<string> {
	return createLogFile('voca-scoring', `voca-score-${mode}`, new Date());
}

async function emitStatistics(reportPath: string, section: string): Promise<void> {
	console.log(section);
	console.log();
	await appendFile(reportPath, `${section}\n\n`, 'utf8');
}

async function processBatches({
	mode,
	onBatch,
	reportPath,
	limit
}: {
	mode: ScoreMode;
	onBatch: (batchNumber: number, statistics: RunStatistics) => Promise<void>;
	reportPath: string;
	limit?: number;
}): Promise<void> {
	const statistics = createRunStatistics();
	let deferredCount = 0;
	let afterId: mongoose.Types.ObjectId | undefined;
	let attempted = 0;

	while (limit == null || attempted < limit) {
		const vocas = await loadBatch(mode, afterId, nextBatchSize(limit, attempted, BATCH_SIZE));

		if (vocas.length === 0) {
			break;
		}
		attempted += vocas.length;
		afterId = vocas.at(-1)!._id;

		const { scores, deferred } = await requestScores(vocas);
		if (deferred.length) {
			await markDeferred(vocas, new Set(deferred.map((item) => item.id)));
			await appendFile(
				`${reportPath}.deferred.jsonl`,
				deferred.map((item) => JSON.stringify(item)).join('\n') + '\n',
				'utf8'
			);
			deferredCount += deferred.length;
			console.log(`확신도 부족으로 ${deferred.length}개 보류: ${reportPath}.deferred.jsonl`);
		}

		const written = await saveScores(scores, mode);

		if (written !== scores.length) {
			throw new Error(`Expected to save ${scores.length} scores, but saved ${written}.`);
		}
		const batchStatistics = createRunStatistics();
		batchStatistics.batches = 1;
		batchStatistics.headwords = new Set(vocas.map((voca) => voca.sourceText)).size;
		addScoresToStatistics(batchStatistics, scores);
		statistics.batches += 1;
		statistics.headwords += batchStatistics.headwords;
		addScoresToStatistics(statistics, scores);
		await onBatch(statistics.batches, batchStatistics);
	}
	console.log(`선택한 단어: ${attempted}개 (보류 ${deferredCount}개)`);
}

async function loadStoredStatistics(): Promise<{
	totalHeadwords: number;
	totalSenses: number;
	difficultyScoredSenses: number;
	difficultyLevels: ScoreDistribution;
	utilityScores: ScoreDistribution;
}> {
	const collection = mongoose.connection.collection('vocas');
	const filter = {
		difficultyLevel: { $type: 'number' },
		utilityScore: { $type: 'number' }
	} as const;
	const difficultyFilter = { ...filter, utilityScore: { $gte: 1 } } as const;
	const [totalSenses, headwords, difficultyScoredSenses, difficultyRows, utilityRows] =
		await Promise.all([
			collection.countDocuments(filter),
			collection.distinct('sourceText', filter),
			collection.countDocuments(difficultyFilter),
			collection
				.aggregate<{ _id: number; count: number }>([
					{ $match: difficultyFilter },
					{ $group: { _id: { $floor: { $add: ['$difficultyLevel', 0.5] } }, count: { $sum: 1 } } },
					{ $sort: { _id: 1 } }
				])
				.toArray(),
			collection
				.aggregate<{ _id: number; count: number }>([
					{ $match: filter },
					{ $group: { _id: { $floor: { $add: ['$utilityScore', 0.5] } }, count: { $sum: 1 } } },
					{ $sort: { _id: 1 } }
				])
				.toArray()
		]);
	const difficultyLevels = createDistribution(1, 10);
	const utilityScores = createDistribution(0, 5);

	for (const row of difficultyRows) {
		difficultyLevels[String(row._id)] = row.count;
	}

	for (const row of utilityRows) {
		utilityScores[String(row._id)] = row.count;
	}

	return {
		totalHeadwords: headwords.length,
		totalSenses,
		difficultyScoredSenses,
		difficultyLevels,
		utilityScores
	};
}

async function main(): Promise<void> {
	const runStartedAt = new Date();
	const { mode, limit } = readScoringOptions(process.argv.slice(2));
	const reportPath = await createReportFile(mode);

	if (mode === 'all') {
		await emitStatistics(reportPath, `[전체 재평가]\n실행 시작: ${runStartedAt.toISOString()}`);
	}

	await mongoose.connect(requireEnvironment('MONGO_URI'));

	try {
		await processBatches({
			mode,
			limit,
			reportPath,
			onBatch: async (batchNumber, statistics) =>
				emitStatistics(reportPath, formatStatisticsSection(`배치 ${batchNumber}`, statistics))
		});
		const stored = await loadStoredStatistics();
		const finalStatistics = {
			headwords: stored.totalHeadwords,
			senses: stored.totalSenses,
			difficultyScoredSenses: stored.difficultyScoredSenses,
			difficultyLevels: stored.difficultyLevels,
			utilityScores: stored.utilityScores
		};

		await emitStatistics(reportPath, formatStatisticsSection('최종 통계', finalStatistics));
		console.log(`TXT 보고서: ${reportPath}`);
	} finally {
		await mongoose.disconnect();
	}
}

await main();
