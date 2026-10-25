import mongoose from 'mongoose';

import {
	LANGUAGE_CODES,
	MAX_LEVEL,
	MAX_UTILITY_SCORE,
	MIN_LEVEL,
	MIN_UTILITY_SCORE
} from '$lib/shared/types/general.type';
import {
	QUIZ_REPORT_APPLY_SECTIONS,
	QUIZ_REPORT_GROUNDS,
	QUIZ_REPORT_ISSUES,
	QUIZ_REPORT_RECOMMENDATIONS,
	QUIZ_REPORT_RESOLUTION_ACTIONS
} from '$lib/shared/types/quiz-report.type';
import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';

const quizExampleSchema = new mongoose.Schema(
	{
		_id: { type: String, required: true },
		sourceSentenceTemplate: { type: String, required: true },
		sourceFillText: { type: String, required: true },
		targetSentenceTemplate: { type: String, required: true },
		targetFillText: { type: String, required: true },
		targetPronunciationText: { type: String, required: true },
		reportCount: { type: Number, required: true },
		addedAt: { type: String, required: true }
	},
	{ _id: false }
);

const vocaSnapshotSchema = new mongoose.Schema(
	{
		sourceText: { type: String, required: true },
		sourceDefinition: { type: String, required: true },
		partOfSpeech: { type: String, required: true, enum: Object.values(PARTS_OF_SPEECH) },
		targetLang: { type: String, required: true, enum: Object.values(LANGUAGE_CODES) },
		targetText: { type: String, required: true },
		targetDefinition: { type: String, required: true },
		difficultyLevel: { type: Number, min: MIN_LEVEL, max: MAX_LEVEL, default: null },
		utilityScore: { type: Number, min: MIN_UTILITY_SCORE, max: MAX_UTILITY_SCORE, default: null }
	},
	{ _id: false }
);

const proposalAttemptSchema = new mongoose.Schema(
	{
		_id: { type: String, required: true },
		createdAt: { type: String, required: true },
		adminInstruction: { type: String, required: false, maxlength: 500 },
		baseFingerprint: { type: String, required: true },
		recommendation: {
			type: String,
			required: true,
			enum: Object.values(QUIZ_REPORT_RECOMMENDATIONS)
		},
		grounds: [{ type: String, enum: Object.values(QUIZ_REPORT_GROUNDS) }],
		explanation: { type: String, required: true },
		repairable: { type: Boolean, required: true },
		suggestedRepair: { type: String, required: true },
		proposedVoca: { type: vocaSnapshotSchema, required: true },
		proposedExample: { type: quizExampleSchema, required: true }
	},
	{ _id: false }
);

const resolutionSchema = new mongoose.Schema(
	{
		action: {
			type: String,
			required: true,
			enum: Object.values(QUIZ_REPORT_RESOLUTION_ACTIONS)
		},
		adminUserId: { type: String, required: true },
		resolvedAt: { type: String, required: true },
		note: { type: String, required: false, maxlength: 500 },
		proposalAttemptId: { type: String, required: false },
		appliedSections: [{ type: String, enum: Object.values(QUIZ_REPORT_APPLY_SECTIONS) }]
	},
	{ _id: false }
);

const quizReportSchema = new mongoose.Schema(
	{
		userId: { type: String, required: true },
		vocaId: { type: String, required: true },
		quizExampleId: { type: String, required: true },
		promptLang: { type: String, required: true, enum: Object.values(LANGUAGE_CODES) },
		answerLang: { type: String, required: true, enum: Object.values(LANGUAGE_CODES) },
		issues: {
			type: [{ type: String, enum: Object.values(QUIZ_REPORT_ISSUES) }],
			required: true
		},
		details: { type: String, required: false, maxlength: 500 },
		vocaSnapshot: { type: vocaSnapshotSchema, required: true },
		quizExampleSnapshot: { type: quizExampleSchema, required: true },
		proposalAttempts: { type: [proposalAttemptSchema], required: true, default: [] },
		resolution: { type: resolutionSchema, required: false }
	},
	{ timestamps: true }
);

quizReportSchema.index({ resolution: 1, createdAt: 1 });
quizReportSchema.index({ vocaId: 1, resolution: 1 });

const QuizReportModel =
	mongoose.models.QuizReport ?? mongoose.model('QuizReport', quizReportSchema);

export default QuizReportModel;
