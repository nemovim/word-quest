import mongoose from 'mongoose';

import type { QuizCardCreate, QuizCardEntity } from '$lib/shared/types/quiz-card.type';
import type { VocaCreate, VocaEntity } from '$lib/shared/types/voca.type';

import QuizCardModel from '$lib/models/quiz-card.model';
import VocaModel from '$lib/models/voca.model';
import { toPojo } from '$lib/shared/utils/general.util';

export async function createCustomVocaBundle(
	vocaData: VocaCreate,
	buildQuizCard: (vocaId: string) => QuizCardCreate
): Promise<{ createdVoca: VocaEntity; createdQuizCard: QuizCardEntity }> {
	return mongoose.connection.transaction(async (session) => {
		const [vocaDocument] = await VocaModel.create([vocaData], { session });
		const quizCardData = buildQuizCard(vocaDocument._id.toString());
		const [quizCardDocument] = await QuizCardModel.create([quizCardData], { session });

		return {
			createdVoca: toPojo(vocaDocument.toObject()),
			createdQuizCard: toPojo(quizCardDocument.toObject())
		};
	});
}
