import { appendFile } from 'node:fs/promises';

import { OpenRouter } from '@openrouter/sdk';
import mongoose from 'mongoose';

import { createLogFile } from './log-file.ts';
import { getOpenRouterModel } from '../src/lib/server/openrouter-config.ts';
import { decodeHtmlEntities } from '../src/lib/shared/utils/html-entity.util.ts';

const HEADWORD_BATCH_SIZE = 100;
const MAX_AI_ATTEMPTS = 5;
const INITIAL_AI_RETRY_DELAY_MS = 2_000;

type VocaForScoring = {
	_id: mongoose.Types.ObjectId;
	originKey: string;
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: string;
	targetText: string;
	targetDefinition: string;
	utilityScore?: number | null;
	scoreEvaluatedAt?: Date | null;
};

type ScoreMode = 'missing' | 'zero' | 'all';

type HeadwordContext = {
	sourceText: string;
	senses: Array<{
		sourceDefinition: string;
		partOfSpeech: string;
		targetText: string;
		targetDefinition: string;
		utilityScore: number | null;
	}>;
};

type Score = {
	id: string;
	difficultyLevel: number;
	koreanUsage: number;
	englishUsage: number;
	isValid: number;
	utilityScore: number;
};

type AiScore = [
	index: number,
	difficultyLevel: number,
	koreanUsage: number,
	englishUsage: number,
	isValid: number
];

type ScoreResponse = {
	scores: unknown[];
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

function requireEnvironment(name: 'MONGO_URI' | 'OPENROUTER_API_KEY'): string {
	const value = process.env[name]?.trim();

	if (value == null || value === '') {
		throw new Error(`${name} is required.`);
	}

	return value;
}

function readJsonContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.map((item) =>
				typeof item === 'object' && item != null && 'text' in item && typeof item.text === 'string'
					? item.text
					: ''
			)
			.join('');
	}

	return '';
}

function buildScoringCriteriaPrompt(): string {
	return [
		'Score each Korean-to-English vocabulary sense for a Korean learner studying English.',
		'Set isValid to 1 only when targetText is a correct and natural translation of the exact source sense described by sourceDefinition, partOfSpeech, and targetDefinition and is suitable as a standalone vocabulary-quiz answer; otherwise set isValid to 0.',
		'Explanatory paraphrases and transliterations that are not established English expressions are unsuitable. Established loanwords and lexicalized multiword expressions are valid.',
		'Separately score koreanUsage for the exact Korean sourceText sense and englishUsage for the exact English targetText sense. Judge the supplied senses, not the overall familiarity of the headwords or their other meanings.',
		'Korean-side usage measures active usage: how often modern Korean speakers naturally choose sourceText to express the exact meaning in sourceDefinition in current speech or writing. Do not substitute the frequency or familiarity of the underlying concept.',
		'Mere recognizability or easy comprehension must not raise koreanUsage. If speakers understand the expression but rarely choose it in current speech or writing, koreanUsage must not exceed 2.',
		'When sourceText is polysemous, do not transfer the familiarity of its common meanings to the supplied sense.',
		'Use this 1-to-5 scale independently for koreanUsage and englishUsage: 1 obsolete or extremely rare; 2 limited, specialized, or uncommon; 3 regularly useful; 4 common and broadly practical; 5 core everyday vocabulary.',
		'Always return both usage scores from 1 to 5 even when isValid is 0. Do not average them or calculate a final utilityScore; the application will use 0 for an invalid pair and the lower usage score for a valid pair.',
		'difficultyLevel measures how difficult the exact English target expression is for a Korean learner to understand, recall, produce, and use correctly in the supplied English sense.',
		'Consider the acquisition level of that exact sense, lexical familiarity, form length and complexity, idiomaticity, and usage restrictions.',
		'difficultyLevel is an integer from 1 to 10: 1-2 beginner; 3-4 easy; 5-6 intermediate; 7-8 advanced; 9-10 exceptionally difficult.',
		'Do not base difficultyLevel on the rarity or difficulty of the Korean source sense or on the obscurity of the underlying concept.'
	].join(' ');
}

function buildDeveloperPrompt(): string {
	return [
		'Return JSON only and score every supplied Korean-to-English vocabulary sense.',
		buildScoringCriteriaPrompt(),
		'Keep each index unchanged. Return each index exactly once. Do not add explanations or examples.',
		'For each score tuple, use [index, difficultyLevel, koreanUsage, englishUsage, isValid].',
		'Return one object shaped exactly as {"scores":[[0,1,5,5,1],[1,3,2,4,1],[2,4,3,3,0]]}.'
	].join(' ');
}

function buildRecheckDeveloperPrompt(): string {
	return [
		'Independently recheck vocabulary pairs that a first pass marked with utilityScore 0; do not presume that the first decision was correct.',
		'Return JSON only and score every target item.',
		'Use the supplied headwordContexts to compare sibling senses, but judge each target by its own sourceDefinition, partOfSpeech, targetText, and targetDefinition.',
		buildScoringCriteriaPrompt(),
		'Keep each index unchanged and return it exactly once. Do not add explanations or examples.',
		'For each score tuple, use [index, difficultyLevel, koreanUsage, englishUsage, isValid].',
		'Return one object shaped exactly as {"scores":[[0,1,5,5,1],[1,3,2,4,1],[2,4,3,3,0]]}.'
	].join(' ');
}

function validateScores(payload: ScoreResponse, vocas: VocaForScoring[]): Score[] {
	if (!Array.isArray(payload.scores)) {
		throw new Error('AI response does not contain a scores array.');
	}

	for (const score of payload.scores) {
		if (
			!Array.isArray(score) ||
			score.length !== 5 ||
			!Number.isInteger(score[0]) ||
			score[0] < 0 ||
			score[0] >= vocas.length ||
			!Number.isInteger(score[1]) ||
			score[1] < 1 ||
			score[1] > 10 ||
			!Number.isInteger(score[2]) ||
			score[2] < 1 ||
			score[2] > 5 ||
			!Number.isInteger(score[3]) ||
			score[3] < 1 ||
			score[3] > 5 ||
			!Number.isInteger(score[4]) ||
			(score[4] !== 0 && score[4] !== 1)
		) {
			throw new Error(`AI returned an invalid score tuple: ${JSON.stringify(score)}.`);
		}
	}

	const scores = payload.scores as AiScore[];
	const returnedIndices = new Set(scores.map((score) => score[0]));

	if (
		scores.length !== vocas.length ||
		returnedIndices.size !== vocas.length ||
		vocas.some((_, index) => !returnedIndices.has(index))
	) {
		throw new Error('AI response must contain every requested index exactly once.');
	}

	return scores.map((score) => ({
		id: vocas[score[0]]._id.toString(),
		difficultyLevel: score[1],
		koreanUsage: score[2],
		englishUsage: score[3],
		isValid: score[4],
		utilityScore: score[4] === 0 ? 0 : Math.min(score[2], score[3])
	}));
}

function readScoreMode(args: string[]): ScoreMode {
	if (args.length !== 1) {
		throw new Error('Usage: npm run vocas:score -- <missing|zero|all>');
	}

	const mode = args[0];
	if (mode !== 'missing' && mode !== 'zero' && mode !== 'all') {
		throw new Error('Usage: npm run vocas:score -- <missing|zero|all>');
	}

	return mode;
}

function buildScoreFilter(mode: ScoreMode, runStartedAt: Date) {
	if (mode === 'zero') {
		return { utilityScore: 0, scoreReviewCount: { $ne: 2 } };
	}

	if (mode === 'missing') {
		return { difficultyLevel: null, utilityScore: null };
	}

	return {
		$or: [
			{ difficultyLevel: null },
			{ utilityScore: null },
			{ scoreEvaluatedAt: { $exists: false } },
			{ scoreEvaluatedAt: null },
			{ scoreEvaluatedAt: { $lt: runStartedAt } }
		]
	};
}

async function loadBatch(mode: ScoreMode, runStartedAt: Date): Promise<VocaForScoring[]> {
	const collection = mongoose.connection.collection<VocaForScoring>('vocas');
	const dictionaryFilter = {
		targetLang: 'en',
		createdByUserId: { $exists: false }
	} as const;
	const scoreFilter = buildScoreFilter(mode, runStartedAt);
	const batchFilter = { ...dictionaryFilter, ...scoreFilter };
	const headwords = await collection
		.aggregate<{ sourceText: string }>([
			{ $match: batchFilter },
			{
				$group: {
					_id: '$sourceText',
					firstOriginKey: { $min: '$originKey' }
				}
			},
			{ $sort: { firstOriginKey: 1 } },
			{ $limit: HEADWORD_BATCH_SIZE },
			{ $project: { _id: 0, sourceText: '$_id' } }
		])
		.toArray();

	if (headwords.length === 0) {
		return [];
	}

	return collection
		.find({
			...batchFilter,
			sourceText: { $in: headwords.map((headword) => headword.sourceText) }
		})
		.sort({ sourceText: 1, originKey: 1 })
		.project<VocaForScoring>({
			originKey: 1,
			sourceText: 1,
			sourceDefinition: 1,
			partOfSpeech: 1,
			targetText: 1,
			targetDefinition: 1
		})
		.toArray();
}

async function loadHeadwordContexts(vocas: VocaForScoring[]): Promise<HeadwordContext[]> {
	const sourceTexts = Array.from(new Set(vocas.map((voca) => voca.sourceText)));
	const collection = mongoose.connection.collection<VocaForScoring>('vocas');
	const siblings = await collection
		.find({
			targetLang: 'en',
			createdByUserId: { $exists: false },
			sourceText: { $in: sourceTexts }
		})
		.sort({ sourceText: 1, originKey: 1 })
		.project<VocaForScoring>({
			sourceText: 1,
			sourceDefinition: 1,
			partOfSpeech: 1,
			targetText: 1,
			targetDefinition: 1,
			utilityScore: 1
		})
		.toArray();

	return sourceTexts.map((sourceText) => ({
		sourceText: decodeHtmlEntities(sourceText),
		senses: siblings
			.filter((sibling) => sibling.sourceText === sourceText)
			.map((sibling) => ({
				sourceDefinition: decodeHtmlEntities(sibling.sourceDefinition),
				partOfSpeech: sibling.partOfSpeech,
				targetText: decodeHtmlEntities(sibling.targetText),
				targetDefinition: decodeHtmlEntities(sibling.targetDefinition),
				utilityScore: sibling.utilityScore ?? null
			}))
	}));
}

async function requestScores(vocas: VocaForScoring[], mode: ScoreMode) {
	const apiKey = requireEnvironment('OPENROUTER_API_KEY');
	const client = new OpenRouter({ apiKey });
	const input = vocas.map((voca, index) => ({
		index,
		sourceText: decodeHtmlEntities(voca.sourceText),
		sourceDefinition: decodeHtmlEntities(voca.sourceDefinition),
		partOfSpeech: voca.partOfSpeech,
		targetText: decodeHtmlEntities(voca.targetText),
		targetDefinition: decodeHtmlEntities(voca.targetDefinition)
	}));
	const userContent =
		mode === 'zero'
			? JSON.stringify({ targets: input, headwordContexts: await loadHeadwordContexts(vocas) })
			: JSON.stringify(input);
	const model = getOpenRouterModel();
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt += 1) {
		try {
			const response = await client.chat.send({
				chatRequest: {
					stream: false,
					model,
					temperature: 0,
					maxCompletionTokens: 16384,
					responseFormat: { type: 'json_object' },
					messages: [
						{
							role: 'developer',
							content: mode === 'zero' ? buildRecheckDeveloperPrompt() : buildDeveloperPrompt()
						},
						{ role: 'user', content: userContent }
					]
				}
			});

			if (!('choices' in response)) {
				throw new Error('OpenRouter returned an unexpected streaming response.');
			}

			const choice = response.choices[0];

			if (choice == null) {
				throw new Error('OpenRouter returned no completion choice.');
			}

			if (choice.finishReason === 'length') {
				throw new Error('AI output reached the token limit before completing the score JSON.');
			}

			const content = readJsonContent(choice.message.content);
			let payload: ScoreResponse;

			try {
				payload = JSON.parse(content) as ScoreResponse;
			} catch (error) {
				throw new Error(
					`AI returned invalid JSON (finishReason: ${choice.finishReason ?? 'unknown'}, characters: ${content.length}).`,
					{ cause: error }
				);
			}

			return {
				model: response.model,
				scores: validateScores(payload, vocas),
				usage: response.usage
			};
		} catch (error) {
			lastError = error;

			if (attempt === MAX_AI_ATTEMPTS) {
				break;
			}

			const delayMs = INITIAL_AI_RETRY_DELAY_MS * 2 ** (attempt - 1);
			const message = error instanceof Error ? error.message : String(error);
			console.warn(
				`AI 응답 오류 (${attempt}/${MAX_AI_ATTEMPTS}): ${message} ${(delayMs / 1_000).toLocaleString()}초 후 재시도합니다.`
			);
			await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
		}
	}

	throw new Error(`AI scoring failed after ${MAX_AI_ATTEMPTS} attempts.`, { cause: lastError });
}

async function saveScores(scores: Score[], mode: ScoreMode, runStartedAt: Date): Promise<number> {
	const collection = mongoose.connection.collection('vocas');
	const scoreEvaluatedAt = new Date();
	const result = await collection.bulkWrite(
		scores.map((score) => ({
			updateOne: {
				filter: {
					_id: new mongoose.Types.ObjectId(score.id),
					...buildScoreFilter(mode, runStartedAt)
				},
				update: {
					$set: {
						difficultyLevel: score.difficultyLevel,
						utilityScore: score.utilityScore,
						scoreReviewCount: mode === 'zero' ? 2 : 1,
						scoreEvaluatedAt
					}
				}
			}
		}))
	);

	return result.modifiedCount;
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
		statistics.utilityScores[String(score.utilityScore)] += 1;

		if (score.utilityScore > 0) {
			statistics.difficultyScoredSenses += 1;
			statistics.difficultyLevels[String(score.difficultyLevel)] += 1;
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
		`utilityScore: ${formatDistribution(statistics.utilityScores)}`,
		`difficultyLevel (utilityScore 1-5, ${statistics.difficultyScoredSenses.toLocaleString()}개): ${formatDistribution(statistics.difficultyLevels)}`
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
	runStartedAt
}: {
	mode: ScoreMode;
	onBatch: (batchNumber: number, statistics: RunStatistics) => Promise<void>;
	runStartedAt: Date;
}): Promise<void> {
	const statistics = createRunStatistics();

	while (true) {
		const vocas = await loadBatch(mode, runStartedAt);

		if (vocas.length === 0) {
			break;
		}

		const scores = (await requestScores(vocas, mode)).scores;

		const written = await saveScores(scores, mode, runStartedAt);

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
		targetLang: 'en',
		createdByUserId: { $exists: false },
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
					{ $group: { _id: '$difficultyLevel', count: { $sum: 1 } } },
					{ $sort: { _id: 1 } }
				])
				.toArray(),
			collection
				.aggregate<{ _id: number; count: number }>([
					{ $match: filter },
					{ $group: { _id: '$utilityScore', count: { $sum: 1 } } },
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
	const mode = readScoreMode(process.argv.slice(2));
	const reportPath = await createReportFile(mode);

	if (mode === 'all') {
		await emitStatistics(
			reportPath,
			`[전체 재평가]\nscoreEvaluatedAt 기준 시각: ${runStartedAt.toISOString()}`
		);
	}

	await mongoose.connect(requireEnvironment('MONGO_URI'));

	try {
		await processBatches({
			mode,
			onBatch: async (batchNumber, statistics) =>
				emitStatistics(reportPath, formatStatisticsSection(`배치 ${batchNumber}`, statistics)),
			runStartedAt
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
