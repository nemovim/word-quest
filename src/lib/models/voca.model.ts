import mongoose from 'mongoose';

import {
	LANGUAGE_CODES,
	MAX_LEVEL,
	MAX_UTILITY_SCORE,
	MIN_LEVEL,
	MIN_UTILITY_SCORE
} from '$lib/shared/types/general.type';
import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';

const vocaSchema = new mongoose.Schema({
	originKey: { type: String, required: true, unique: true },
	createdByUserId: { type: String, required: false },
	sourceText: { type: String, required: true },
	sourceDefinition: { type: String, required: true },
	partOfSpeech: {
		type: String,
		required: true,
		enum: Object.values(PARTS_OF_SPEECH)
	},
	targetLang: {
		type: String,
		required: true,
		enum: Object.values(LANGUAGE_CODES)
	},
	targetText: { type: String, required: true },
	normalizedTargetText: { type: String, required: true },
	targetDefinition: { type: String, required: true },
	difficultyLevel: {
		type: Number,
		default: null,
		min: MIN_LEVEL,
		max: MAX_LEVEL
	},
	utilityScore: {
		type: Number,
		default: null,
		min: MIN_UTILITY_SCORE,
		max: MAX_UTILITY_SCORE
	},
	scoreReviewCount: { type: Number, required: true, default: 0, min: 0, max: 2 },
	scoreEvaluatedAt: { type: Date, required: false, default: null },
	quizExcludedByReportId: { type: String, required: false }
});

vocaSchema.index({ targetLang: 1, sourceText: 1 });
vocaSchema.index({ targetLang: 1, normalizedTargetText: 1 });
vocaSchema.index({ targetLang: 1, sourceText: 1, normalizedTargetText: 1 });
vocaSchema.index({ difficultyLevel: 1, utilityScore: -1 });
vocaSchema.index({ targetLang: 1, utilityScore: 1, originKey: 1 });
vocaSchema.index({ utilityScore: 1, scoreReviewCount: 1, originKey: 1 });
vocaSchema.index({ scoreEvaluatedAt: 1, originKey: 1 });
vocaSchema.index({ quizExcludedByReportId: 1 });

const VocaModel = mongoose.models.Voca ?? mongoose.model('Voca', vocaSchema);

export default VocaModel;
