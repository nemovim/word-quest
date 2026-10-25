import type { AnswerMemoEntity, AnswerMemoCreate } from '$lib/shared/types/answer-memo.type';
import type { LanguageCode } from '$lib/shared/types/general.type';

import AnswerMemoModel from '$lib/models/answer-memo.model';
import { toPojo } from '$lib/shared/utils/general.util';

export async function findAnswerMemoByKey(
	quizExampleId: string,
	promptLang: LanguageCode,
	answerLang: LanguageCode,
	normalizedAnswerText: string
): Promise<AnswerMemoEntity | null> {
	const document = await AnswerMemoModel.findOne({
		quizExampleId,
		promptLang,
		answerLang,
		normalizedAnswerText
	}).lean();

	return document == null ? null : toPojo(document);
}

export async function upsertAnswerMemo(
	answerMemoData: AnswerMemoCreate
): Promise<AnswerMemoEntity> {
	const document = await AnswerMemoModel.findOneAndUpdate(
		{
			quizExampleId: answerMemoData.quizExampleId,
			promptLang: answerMemoData.promptLang,
			answerLang: answerMemoData.answerLang,
			normalizedAnswerText: answerMemoData.normalizedAnswerText
		},
		answerMemoData,
		{
			upsert: true,
			returnDocument: 'after',
			setDefaultsOnInsert: true
		}
	).lean();

	if (document == null) {
		throw new Error('Failed to upsert answer memo.');
	}

	return toPojo(document);
}
