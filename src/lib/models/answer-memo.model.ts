import mongoose from 'mongoose';

import { AI_JUDGE_REASON_CODES, LANGUAGE_CODES } from '$lib/shared/types/general.type';

const answerMemoSchema = new mongoose.Schema(
	{
		vocaId: { type: String, required: true },
		quizExampleId: { type: String, required: true },
		promptLang: {
			type: String,
			required: true,
			enum: Object.values(LANGUAGE_CODES)
		},
		answerLang: {
			type: String,
			required: true,
			enum: Object.values(LANGUAGE_CODES)
		},
		normalizedAnswerText: { type: String, required: true },
		reasonCode: {
			type: String,
			required: true,
			enum: Object.values(AI_JUDGE_REASON_CODES)
		},
		hintText: { type: String, required: true },
		retryCount: { type: Number, required: true, default: 0 }
	},
	{
		timestamps: true
	}
);

answerMemoSchema.index(
	{
		quizExampleId: 1,
		promptLang: 1,
		answerLang: 1,
		normalizedAnswerText: 1
	},
	{ unique: true }
);

const AnswerMemoModel =
	mongoose.models.AnswerMemo ?? mongoose.model('AnswerMemo', answerMemoSchema);

export default AnswerMemoModel;
