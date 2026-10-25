import mongoose from 'mongoose';

import { LANGUAGE_CODES } from '$lib/shared/types/general.type';

const reviewSchema = new mongoose.Schema(
	{
		userId: { type: String, required: true },
		vocaId: { type: String, required: true },
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
		reviewStage: { type: Number, required: true, default: 0 },
		dueAt: { type: Date, required: true },
		lastReviewedAt: { type: Date, required: true },
		correctCount: { type: Number, required: true, default: 0 },
		wrongCount: { type: Number, required: true, default: 0 },
		exampleScoreById: {
			type: Map,
			of: Number,
			default: {}
		}
	},
	{
		timestamps: true
	}
);

reviewSchema.index({ userId: 1, vocaId: 1, promptLang: 1, answerLang: 1 }, { unique: true });
reviewSchema.index({ userId: 1, dueAt: 1 });
reviewSchema.index({ userId: 1, promptLang: 1, dueAt: 1 });
reviewSchema.index({ userId: 1, answerLang: 1, dueAt: 1 });
reviewSchema.index({ userId: 1, lastReviewedAt: -1 });
reviewSchema.index({ userId: 1, vocaId: 1, createdAt: 1 });
reviewSchema.index({ vocaId: 1, promptLang: 1, answerLang: 1 });

const ReviewModel = mongoose.models.Review ?? mongoose.model('Review', reviewSchema);

export default ReviewModel;
