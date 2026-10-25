import type { QuizCardId, QuizExampleId, VocaId } from '$lib/shared/types/general.type';

export type QuizExample = {
	_id: QuizExampleId;
	sourceSentenceTemplate: string;
	sourceFillText: string;
	targetSentenceTemplate: string;
	targetFillText: string;
	targetPronunciationText: string;
	reportCount: number;
	addedAt: string;
};

export type QuizCardCreate = {
	vocaId: VocaId;
	examples: QuizExample[];
};

export type QuizCardEntity = QuizCardCreate & {
	_id: QuizCardId;
	createdAt: string;
	updatedAt: string;
};

export type QuizCard = QuizCardEntity;
