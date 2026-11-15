import { readFile, rename, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';

type UsageSummary = {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost: number;
};

export type ExampleCheckpoint = {
	version: 1;
	mode: 'missing' | 'existing' | 'all';
	model: string;
	startedAt: string;
	logPath: string;
	limit?: number;
	total: number;
	batchNumber: number;
	attempted: number;
	savedVocas: number;
	savedExamples: number;
	retries: number;
	codeRejected: number;
	reviewRejected: number;
	failedVocaIds: string[];
	generationUsage: UsageSummary;
	reviewUsage: UsageSummary;
	cursor?: { utilityScore: number; id: string };
	completed: boolean;
};

export async function saveCheckpoint(path: string, checkpoint: ExampleCheckpoint) {
	const tempPath = `${path}.${process.pid}.tmp`;
	await writeFile(tempPath, JSON.stringify(checkpoint, null, 2), 'utf8');
	await rename(tempPath, path);
}

export async function readCheckpoint(path: string): Promise<ExampleCheckpoint> {
	const value = JSON.parse(await readFile(path, 'utf8')) as ExampleCheckpoint;
	if (
		value.version !== 1 ||
		!['missing', 'existing', 'all'].includes(value.mode) ||
		!value.model ||
		!value.logPath ||
		!Number.isSafeInteger(value.total) ||
		!Number.isSafeInteger(value.attempted) ||
		!Number.isSafeInteger(value.batchNumber) ||
		!Array.isArray(value.failedVocaIds) ||
		!value.generationUsage ||
		!value.reviewUsage ||
		(value.cursor &&
			(!mongoose.isValidObjectId(value.cursor.id) || !Number.isFinite(value.cursor.utilityScore)))
	)
		throw new Error('Invalid example-generation checkpoint.');
	return value;
}
