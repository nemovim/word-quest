import { mkdir, writeFile } from 'node:fs/promises';

import mongoose from 'mongoose';

// Only equipment progression is reset. Vocabulary, reviews, resources and
// unopened chests are deliberately outside this update.
const defaults = {
	weapon: 0,
	attack: 10,
	criticalChance: 1,
	hitGold: 1,
	attackUpgrades: 0,
	criticalUpgrades: 0,
	incomeUpgrades: 0,
	chanceUpgrades: 0,
	upgradeFailures: 0,
	chargeVersion: 1,
	baseSuccessRate: 0,
	successRate: 0
};

async function main() {
	if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');
	await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
	try {
		const games = mongoose.connection.collection('games');
		if (!process.argv.includes('--apply')) {
			console.log(
				JSON.stringify({ mode: 'preview', users: await games.countDocuments(), defaults })
			);
			return;
		}
		await mkdir('logs', { recursive: true });
		const backup = `logs/upgrade-reset-${Date.now()}.json`;
		const session = await mongoose.startSession();
		try {
			let resetCount = 0;
			await session.withTransaction(async () => {
				const documents = await games.find({}, { session }).toArray();
				if (documents.some((doc) => (doc.lockUntil ?? 0) > Date.now())) {
					throw new Error('An upgrade is in progress. Retry after it finishes.');
				}
				// Persist a recoverable snapshot before any database mutation.
				await writeFile(backup, JSON.stringify(documents, null, 2), { flag: 'w' });
				const fields = Object.fromEntries(
					Object.entries(defaults).map(([key, value]) => [`state.${key}`, value])
				);
				const result = await games.updateMany(
					{},
					{ $set: fields, $inc: { 'state.revision': 1 } },
					{ session }
				);
				resetCount = result.modifiedCount;
				const invalid = await games.countDocuments(
					{ $or: Object.entries(fields).map(([key, value]) => ({ [key]: { $ne: value } })) },
					{ session }
				);
				if (invalid) throw new Error('Reset verification failed. Rolling back.');
			});
			console.log(JSON.stringify({ mode: 'applied', users: resetCount, backup }));
		} finally {
			await session.endSession();
		}
	} finally {
		await mongoose.disconnect();
	}
}

main().catch((error: unknown) => {
	// Connection errors can contain host information; avoid printing credentials.
	console.error(error instanceof Error ? error.name : 'Reset failed');
	process.exitCode = 1;
});
