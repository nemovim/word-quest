import type {
	AiJudgeReasonCode,
	AnswerMemoId,
	LanguageCode,
	QuizExampleId,
	VocaId
} from '$lib/shared/types/general.type';

export type AnswerMemoCreate = {
	vocaId: VocaId;
	quizExampleId: QuizExampleId;
	promptLang: LanguageCode;
	answerLang: LanguageCode;
	normalizedAnswerText: string;
	reasonCode: AiJudgeReasonCode;
	hintText: string;
	retryCount: number;
};

export type AnswerJudgeResult = Pick<AnswerMemoCreate, 'reasonCode' | 'hintText'>;

export type AnswerMemoEntity = AnswerMemoCreate & {
	_id: AnswerMemoId;
	createdAt: string;
	updatedAt: string;
};

export type AnswerMemo = AnswerMemoEntity;
