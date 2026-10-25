import type { LanguageCode, UserId, VocaId } from '$lib/shared/types/general.type';

export const PARTS_OF_SPEECH = {
	INTERJECTION: 'interjection',
	DETERMINER: 'determiner',
	PRONOUN: 'pronoun',
	VERB: 'verb',
	NOUN: 'noun',
	ADVERB: 'adverb',
	NUMERAL: 'numeral',
	ADJECTIVE: 'adjective'
} as const;

export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[keyof typeof PARTS_OF_SPEECH];

export type VocaCreate = {
	originKey: string;
	createdByUserId?: UserId;
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: PartOfSpeech;
	targetLang: LanguageCode;
	targetText: string;
	normalizedTargetText: string;
	targetDefinition: string;
	difficultyLevel: number | null;
	utilityScore: number | null;
	scoreReviewCount?: number;
	scoreEvaluatedAt?: Date | null;
	quizExcludedByReportId?: string;
};

export type VocaEntity = VocaCreate & {
	_id: VocaId;
};

export type Voca = VocaEntity;
