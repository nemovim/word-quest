import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';

const quizExampleSchema = new mongoose.Schema(
	{
		_id: {
			type: String,
			required: true,
			default: randomUUID
		},
		sourceSentenceTemplate: { type: String, required: true },
		sourceFillText: { type: String, required: true },
		targetSentenceTemplate: { type: String, required: true },
		targetFillText: { type: String, required: true },
		targetPronunciationText: { type: String, required: true },
		reportCount: { type: Number, required: true, default: 0 },
		addedAt: { type: Date, required: true, default: Date.now }
	},
	{ _id: false }
);

const quizCardSchema = new mongoose.Schema(
	{
		_id: {
			type: String,
			required: true,
			default: randomUUID
		},
		vocaId: { type: String, required: true, unique: true },
		examples: {
			type: [quizExampleSchema],
			default: []
		}
	},
	{
		timestamps: true
	}
);

// quizCardSchema.index({ vocaId: 1 }, { unique: true });

const QuizCardModel = mongoose.models.QuizCard ?? mongoose.model('QuizCard', quizCardSchema);

export default QuizCardModel;
