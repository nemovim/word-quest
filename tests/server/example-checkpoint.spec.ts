import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
	readCheckpoint,
	saveCheckpoint,
	type ExampleCheckpoint
} from '../../scripts/example-checkpoint';

it('atomically saves and reloads the cursor and counters across batches', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'example-checkpoint-'));
	const path = join(dir, 'run.json');
	const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
	const checkpoint: ExampleCheckpoint = {
		version: 1,
		mode: 'missing',
		model: 'test/model',
		startedAt: '2026-11-15T00:00:00.000Z',
		logPath: 'logs/run.log',
		total: 20,
		batchNumber: 0,
		attempted: 0,
		savedVocas: 0,
		savedExamples: 0,
		retries: 0,
		codeRejected: 0,
		reviewRejected: 0,
		failedVocaIds: [],
		generationUsage: usage,
		reviewUsage: usage,
		completed: false
	};
	try {
		await saveCheckpoint(path, checkpoint);
		const updated = {
			...checkpoint,
			attempted: 10,
			batchNumber: 1,
			cursor: { utilityScore: 3, id: '507f1f77bcf86cd799439011' }
		};
		await saveCheckpoint(path, updated);
		expect(await readCheckpoint(path)).toEqual(updated);
		expect(JSON.parse(await readFile(path, 'utf8')).attempted).toBe(10);
		await writeFile(
			path,
			JSON.stringify({ ...updated, cursor: { utilityScore: 3, id: 'invalid' } })
		);
		await expect(readCheckpoint(path)).rejects.toThrow('Invalid example-generation checkpoint');
	} finally {
		await rm(path, { force: true });
		await rmdir(dir);
	}
});
