import type { LanguageCode, QuizExampleId, UserId, VocaId } from '$lib/shared/types/general.type';
import type { QuizExample } from '$lib/shared/types/quiz-card.type';
import type { PartOfSpeech } from '$lib/shared/types/voca.type';

export const QUIZ_REPORT_ISSUES = {
	WORD_MEANING: 'wordMeaning',
	EXAMPLE: 'example',
	TRANSLATION: 'translation',
	PRONUNCIATION: 'pronunciation',
	UTILITY_TOO_HIGH: 'utilityTooHigh',
	UTILITY_TOO_LOW: 'utilityTooLow',
	DIFFICULTY_TOO_HIGH: 'difficultyTooHigh',
	DIFFICULTY_TOO_LOW: 'difficultyTooLow',
	NOT_SUITABLE_FOR_QUIZ: 'notSuitableForQuiz',
	OTHER: 'other'
} as const;

export type QuizReportIssue = (typeof QUIZ_REPORT_ISSUES)[keyof typeof QUIZ_REPORT_ISSUES];

export const QUIZ_REPORT_RECOMMENDATIONS = {
	KEEP: 'keep',
	REPAIR: 'repair',
	EXCLUDE: 'exclude'
} as const;

export type QuizReportRecommendation =
	(typeof QUIZ_REPORT_RECOMMENDATIONS)[keyof typeof QUIZ_REPORT_RECOMMENDATIONS];

export const QUIZ_REPORT_GROUNDS = {
	TOO_TRIVIAL: 'tooTrivial',
	NON_LEXICAL: 'nonLexical',
	PROPER_NOUN: 'properNoun',
	TOO_SPECIALIZED: 'tooSpecialized',
	OVERLY_LONG: 'overlyLong',
	OFFENSIVE: 'offensive',
	OBSOLETE: 'obsolete',
	AMBIGUOUS: 'ambiguous',
	OTHER: 'other'
} as const;

export type QuizReportGround = (typeof QUIZ_REPORT_GROUNDS)[keyof typeof QUIZ_REPORT_GROUNDS];

export const QUIZ_REPORT_RESOLUTION_ACTIONS = {
	PROPOSAL_APPLIED: 'proposalApplied',
	EXAMPLE_DELETED: 'exampleDeleted',
	VOCA_EXCLUDED: 'vocaExcluded',
	DISMISSED: 'dismissed'
} as const;

export const QUIZ_REPORT_APPLY_SECTIONS = {
	VOCA: 'voca',
	EXAMPLE: 'example',
	DIFFICULTY: 'difficulty',
	UTILITY: 'utility'
} as const;

export type QuizReportApplySection =
	(typeof QUIZ_REPORT_APPLY_SECTIONS)[keyof typeof QUIZ_REPORT_APPLY_SECTIONS];

export type QuizReportResolutionAction =
	(typeof QUIZ_REPORT_RESOLUTION_ACTIONS)[keyof typeof QUIZ_REPORT_RESOLUTION_ACTIONS];

export type QuizReportVocaSnapshot = {
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: PartOfSpeech;
	targetLang: LanguageCode;
	targetText: string;
	targetDefinition: string;
	difficultyLevel: number | null;
	utilityScore: number | null;
};

export type QuizReportProposalAttempt = {
	_id: string;
	createdAt: string;
	adminInstruction?: string;
	baseFingerprint: string;
	recommendation: QuizReportRecommendation;
	grounds: QuizReportGround[];
	explanation: string;
	repairable: boolean;
	suggestedRepair: string;
	proposedVoca: QuizReportVocaSnapshot;
	proposedExample: QuizExample;
};

export type QuizReportResolution = {
	action: QuizReportResolutionAction;
	adminUserId: UserId;
	resolvedAt: string;
	note?: string;
	proposalAttemptId?: string;
	appliedSections?: QuizReportApplySection[];
};

export type QuizReportAdminDraft = {
	proposalAttemptId: string;
	sections: QuizReportApplySection[];
	proposedVoca: QuizReportVocaSnapshot;
	proposedExample: QuizExample;
};

export type QuizReportCreate = {
	userId: UserId;
	vocaId: VocaId;
	quizExampleId: QuizExampleId;
	promptLang: LanguageCode;
	answerLang: LanguageCode;
	issues: QuizReportIssue[];
	details?: string;
};

export type QuizReportRecordCreate = QuizReportCreate & {
	vocaSnapshot: QuizReportVocaSnapshot;
	quizExampleSnapshot: QuizExample;
};

export type QuizReportEntity = QuizReportRecordCreate & {
	_id: string;
	proposalAttempts: QuizReportProposalAttempt[];
	resolution?: QuizReportResolution;
	createdAt: string;
	updatedAt: string;
};

export type QuizReport = QuizReportEntity;
