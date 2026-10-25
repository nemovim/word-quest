import type { AnswerMemo, AnswerMemoCreate } from '$lib/shared/types/answer-memo.type';

import { findAnswerMemoByKey, upsertAnswerMemo } from '$lib/repositories/answer-memo.repository';

export async function findCachedJudge(
	quizExampleId: string,
	promptLang: AnswerMemo['promptLang'],
	answerLang: AnswerMemo['answerLang'],
	normalizedAnswerText: string
): Promise<AnswerMemo | null> {
	return findAnswerMemoByKey(quizExampleId, promptLang, answerLang, normalizedAnswerText);
}

export async function saveJudgeResult(answerMemoData: AnswerMemoCreate): Promise<AnswerMemo> {
	return upsertAnswerMemo(answerMemoData);
}
