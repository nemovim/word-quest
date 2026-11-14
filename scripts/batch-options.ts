import mongoose from 'mongoose';

import { MIN_RECOMMENDED_UTILITY_SCORE } from '../src/lib/shared/types/general.type.ts';

export type ScoreMode = 'all' | 'missing' | 'zero';
export type ExampleMode = 'missing' | 'existing' | 'all';

function parseOptions(args: string[], allowed: string[]) {
	const positional: string[] = [];
	const options: Record<string, string> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith('--')) {
			positional.push(arg);
			continue;
		}
		const [name, inline] = arg.slice(2).split('=', 2);
		if (!allowed.includes(name) || options[name] != null)
			throw new Error(`Unknown or duplicate option: --${name}`);
		const value = inline ?? args[++i];
		if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value.`);
		options[name] = value;
	}
	return { positional, options };
}

function readLimit(raw?: string): number | undefined {
	if (raw == null) return undefined;
	if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
		throw new Error('--limit must be a positive integer.');
	return Number(raw);
}

export function nextBatchSize(
	limit: number | undefined,
	attempted: number,
	maxBatchSize: number
): number {
	return Math.max(0, Math.min(maxBatchSize, limit == null ? maxBatchSize : limit - attempted));
}

export function readScoringOptions(args: string[]) {
	const { positional, options } = parseOptions(args, ['limit']);
	const mode = positional[0];
	if (positional.length !== 1 || (mode !== 'all' && mode !== 'missing' && mode !== 'zero'))
		throw new Error(
			'Usage: npm run vocas:score -- <all|missing|zero> [--limit=N]'
		);
	return { mode: mode as ScoreMode, limit: readLimit(options.limit) };
}

export function readExampleOptions(args: string[]) {
	const { positional, options } = parseOptions(args, ['limit', 'examples']);
	if (positional.length > 1 || (positional.length > 0 && options.examples != null))
		throw new Error('Usage: npm run vocas:examples -- <missing|existing|all> [--limit=N]');
	const mode = positional[0] ?? options.examples;
	if (mode !== 'missing' && mode !== 'existing' && mode !== 'all')
		throw new Error('--examples must be missing, existing, or all.');
	return { mode: mode as ExampleMode, limit: readLimit(options.limit) };
}

export function scoreFilter(mode: ScoreMode) {
	if (mode === 'zero') return { utilityScore: 0, scoreReviewCount: { $ne: 2 } };
	if (mode === 'missing')
		return {
			$or: [{ difficultyLevel: null }, { utilityScore: null }, { scoreEvaluationDeferred: true }]
		};
	return {};
}

export function examplePipeline(
	mode: ExampleMode,
	limit?: number,
	cursor?: { utilityScore: number; id: mongoose.Types.ObjectId }
): mongoose.PipelineStage[] {
	return [
		{
			$match: {
				difficultyLevel: { $type: 'number', $gte: 1, $lte: 10 },
				utilityScore: { $type: 'number', $gte: MIN_RECOMMENDED_UTILITY_SCORE, $lte: 5 },
				scoreEvaluationDeferred: { $ne: true },
				...(cursor
					? {
							$or: [
								{ utilityScore: { $type: 'number', $gte: 0, $lt: cursor.utilityScore } },
								{ utilityScore: cursor.utilityScore, _id: { $gt: cursor.id } }
							]
						}
					: {})
			}
		},
		{ $project: { _id: 1, utilityScore: 1 } },
		{ $sort: { utilityScore: -1, _id: 1 } },
		...(mode === 'all'
			? []
			: [
					{
						$lookup: {
							from: 'quizcards',
							let: { vocaId: { $toString: '$_id' } },
							pipeline: [
								{
									$match: {
										'examples.0': { $exists: true },
										$expr: { $eq: ['$vocaId', '$$vocaId'] }
									}
								},
								{ $limit: 1 }
							],
							as: 'quizCardsWithExamples'
						}
					}
				]),
		...(mode === 'all'
			? []
			: [{ $match: { quizCardsWithExamples: mode === 'missing' ? { $eq: [] } : { $ne: [] } } }]),
		...(limit == null ? [] : [{ $limit: limit }]),
		{ $lookup: { from: 'vocas', localField: '_id', foreignField: '_id', as: 'selectedVoca' } },
		{ $unwind: '$selectedVoca' },
		{ $replaceRoot: { newRoot: '$selectedVoca' } },
		{
			$project: {
				originKey: 1,
				sourceText: 1,
				sourceDefinition: 1,
				partOfSpeech: 1,
				targetLang: 1,
				targetText: 1,
				targetDefinition: 1,
				utilityScore: 1
			}
		}
	];
}
