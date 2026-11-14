import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import {
	examplePipeline,
	nextBatchSize,
	readExampleOptions,
	readScoringOptions,
	scoreFilter
} from '../../scripts/batch-options';

describe('batch options', () => {
	it('accepts a count for either scoring mode and rejects invalid counts', () => {
		expect(readScoringOptions(['all', '--limit', '12'])).toEqual({ mode: 'all', limit: 12 });
		expect(readScoringOptions(['missing', '--limit=2'])).toEqual({ mode: 'missing', limit: 2 });
		for (const value of ['0', '-1', '1.5', 'abc'])
			expect(() => readScoringOptions(['all', '--limit', value])).toThrow();
	});

	it('treats either missing score as unevaluated', () => {
		expect(scoreFilter('missing')).toEqual({
			$or: [{ difficultyLevel: null }, { utilityScore: null }, { scoreEvaluationDeferred: true }]
		});
		expect(scoreFilter('all')).toEqual({});
	});

	it('requires an explicit example scope and accepts positional or legacy options', () => {
		expect(() => readExampleOptions([])).toThrow();
		expect(readExampleOptions(['missing', '--limit=10'])).toEqual({
			mode: 'missing',
			limit: 10
		});
		expect(readExampleOptions(['all'])).toEqual({ mode: 'all', limit: undefined });
		expect(readExampleOptions(['existing'])).toEqual({ mode: 'existing', limit: undefined });
		expect(() => readExampleOptions(['all', '--examples=missing'])).toThrow();
		expect(readExampleOptions(['--examples', 'missing'])).toEqual({
			mode: 'missing',
			limit: undefined
		});
		expect(readExampleOptions(['--examples=existing', '--limit=7'])).toEqual({
			mode: 'existing',
			limit: 7
		});
		expect(readExampleOptions(['--examples', 'all'])).toEqual({ mode: 'all', limit: undefined });
		expect(() => readExampleOptions(['--examples', 'invalid'])).toThrow();
	});

	it('sorts by utility before pagination and filters on example existence', () => {
		const id = new mongoose.Types.ObjectId();
		const pipeline = examplePipeline('existing', 4, { utilityScore: 4.6, id });
		expect(pipeline[0]).toMatchObject({
			$match: { $or: [{ utilityScore: { $lt: 4.6 } }, { utilityScore: 4.6, _id: { $gt: id } }] }
		});
		expect(pipeline.findIndex((stage) => '$sort' in stage)).toBeLessThan(
			pipeline.findIndex((stage) => '$limit' in stage)
		);
		expect(pipeline).toContainEqual({ $sort: { utilityScore: -1, _id: 1 } });
		expect(pipeline).toContainEqual({ $match: { quizCardsWithExamples: { $ne: [] } } });
		expect(pipeline).toContainEqual({ $limit: 4 });
		expect(examplePipeline('missing')).toContainEqual({
			$match: { quizCardsWithExamples: { $eq: [] } }
		});
		expect(examplePipeline('all')).not.toContainEqual({
			$match: { quizCardsWithExamples: { $eq: [] } }
		});
	});

	it('excludes invalid vocabulary from example generation', () => {
		expect(examplePipeline('all')[0]).toMatchObject({
			$match: { utilityScore: { $gte: 2 }, scoreEvaluationDeferred: { $ne: true } }
		});
	});

	it('never selects beyond the requested attempt count', () => {
		expect(nextBatchSize(13, 10, 10)).toBe(3);
		expect(nextBatchSize(13, 13, 10)).toBe(0);
		expect(nextBatchSize(undefined, 10, 10)).toBe(10);
	});
});
