import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function createLogFile(
	category: string,
	filePrefix: string,
	startedAt: Date,
	initialContent = ''
): Promise<string> {
	const directory = resolve('logs', category);
	const timestamp = startedAt.toISOString().replace(/[:.]/g, '-');
	const path = resolve(directory, `${filePrefix}-${timestamp}.log`);

	await mkdir(directory, { recursive: true });
	await writeFile(path, initialContent, 'utf8');
	return path;
}
