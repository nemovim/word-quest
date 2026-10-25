import type {
	LanguageCode,
	QuizExampleId,
	ReviewId,
	UserId,
	VocaId
} from '$lib/shared/types/general.type';

export type ReviewCreate = {
	userId: UserId;
	vocaId: VocaId;
	promptLang: LanguageCode;
	answerLang: LanguageCode;
	reviewStage: number;
	dueAt: string;
	lastReviewedAt: string;
	correctCount: number;
	wrongCount: number;
	exampleScoreById: Partial<Record<QuizExampleId, number>>;
};

export type ReviewEntity = ReviewCreate & {
	_id: ReviewId;
	createdAt: string;
	updatedAt: string;
};

export type Review = ReviewEntity;

export type LevelReview = Pick<
	ReviewEntity,
	'vocaId' | 'reviewStage' | 'correctCount' | 'wrongCount' | 'lastReviewedAt'
>;
