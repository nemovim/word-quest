import mongoose from 'mongoose';

import AnswerMemoModel from '$lib/models/answer-memo.model';
import QuizCardModel from '$lib/models/quiz-card.model';
import QuizReportModel from '$lib/models/quiz-report.model';
import ReviewModel from '$lib/models/review.model';
import UserModel from '$lib/models/user.model';
import VocaModel from '$lib/models/voca.model';

type CachedMongoose = typeof globalThis & {
	__wordQuestMongoosePromise?: Promise<typeof mongoose>;
};

async function connectDb(): Promise<typeof mongoose> {
	const mongoUri = process.env.MONGO_URI;

	if (mongoUri == null || mongoUri.trim() === '') {
		throw new Error('MONGO_URI is required.');
	}

	const cached = globalThis as CachedMongoose;

	if (cached.__wordQuestMongoosePromise == null) {
		cached.__wordQuestMongoosePromise = mongoose.connect(mongoUri, {
			autoIndex: true
		});
	}

	return cached.__wordQuestMongoosePromise;
}

export async function initDb(): Promise<void> {
	await connectDb();

	// Model.init() awaits Mongoose's automatic, idempotent index creation without
	// diffing and synchronizing every collection again on each server startup.
	await Promise.all([
		AnswerMemoModel.init(),
		QuizCardModel.init(),
		QuizReportModel.init(),
		ReviewModel.init(),
		UserModel.init(),
		VocaModel.init()
	]);
}
