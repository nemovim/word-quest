import type { QuizCardEntity, QuizCardCreate } from '$lib/shared/types/quiz-card.type';
import type { VocaEntity } from '$lib/shared/types/voca.type';

import QuizCardModel from '$lib/models/quiz-card.model';
import VocaModel from '$lib/models/voca.model';
import {
	MAX_LEVEL,
	MIN_RECOMMENDED_UTILITY_SCORE,
	MIN_LEVEL
} from '$lib/shared/types/general.type';
import { clampNumber, toPojo } from '$lib/shared/utils/general.util';

export type QuizCandidate = {
	quizCard: QuizCardEntity;
	voca: VocaEntity;
};

type PreselectedVoca = Pick<VocaEntity, '_id' | 'originKey' | 'difficultyLevel' | 'utilityScore'>;

const PRESELECTED_VOCAS_PER_LEVEL = 100;

export function calculateQuizDifficultyWindow(
	currentLevel: number,
	_evidenceCount: number
): { lower: number; upper: number; spread: number } {
	const baseDifficulty = Math.trunc(clampNumber(currentLevel, MIN_LEVEL, MAX_LEVEL));
	const lower = Math.max(MIN_LEVEL, baseDifficulty - 1);
	const upper = Math.min(MAX_LEVEL, baseDifficulty + 1);

	return {
		lower,
		upper,
		spread: upper - lower
	};
}

export function calculateQuizDifficultyQuotas(
	currentLevel: number,
	limit: number
): Array<{ difficultyLevel: number; count: number }> {
	if (limit <= 0) return [];

	const baseDifficulty = Math.trunc(clampNumber(currentLevel, MIN_LEVEL, MAX_LEVEL));
	const easyCount = Math.round(limit * 0.3);
	const currentCount = Math.round(limit * 0.5);
	const harderCount = Math.max(0, limit - easyCount - currentCount);
	const countsByDifficulty = new Map<number, number>();
	const addCount = (difficultyLevel: number, count: number) => {
		const normalizedDifficulty = Math.trunc(clampNumber(difficultyLevel, MIN_LEVEL, MAX_LEVEL));
		countsByDifficulty.set(
			normalizedDifficulty,
			(countsByDifficulty.get(normalizedDifficulty) ?? 0) + count
		);
	};

	addCount(baseDifficulty - 1, easyCount);
	addCount(baseDifficulty, currentCount);
	addCount(baseDifficulty + 1, harderCount);

	return [...countsByDifficulty.entries()].map(([difficultyLevel, count]) => ({
		difficultyLevel,
		count
	}));
}

async function findQuizCardById(quizCardId: string): Promise<QuizCardEntity | null> {
	const raw = await QuizCardModel.findById(quizCardId).lean();
	return raw == null ? null : toPojo(raw);
}

export async function getQuizCardById(quizCardId: string): Promise<QuizCardEntity> {
	const currentQuizCard = await findQuizCardById(quizCardId);

	if (currentQuizCard == null) {
		throw new Error(`Quiz card not found: ${quizCardId}`);
	}

	return currentQuizCard;
}

export async function findQuizCardByVocaId(vocaId: string): Promise<QuizCardEntity | null> {
	const raw = await QuizCardModel.findOne({ vocaId }).lean();
	return raw == null ? null : toPojo(raw);
}

export async function countVocasWithExamples(): Promise<number> {
	return QuizCardModel.countDocuments({ 'examples.0': { $exists: true } });
}

async function findPreselectedVocas(input: {
	currentLevel: number;
	evidenceCount: number;
	excludedVocaIds: string[];
	targetLang?: VocaEntity['targetLang'];
}): Promise<PreselectedVoca[]> {
	const difficultyWindow = calculateQuizDifficultyWindow(input.currentLevel, input.evidenceCount);
	const difficultyLevels = Array.from(
		{ length: MAX_LEVEL - MIN_LEVEL + 1 },
		(_, index) => MIN_LEVEL + index
	).filter(
		(difficultyLevel) =>
			difficultyLevel >= difficultyWindow.lower && difficultyLevel <= difficultyWindow.upper
	);
	const documentsByLevel = await Promise.all(
		difficultyLevels.map((difficultyLevel) =>
			VocaModel.find({
				difficultyLevel,
				...(input.targetLang == null ? {} : { targetLang: input.targetLang }),
				utilityScore: { $gte: MIN_RECOMMENDED_UTILITY_SCORE },
				quizExcludedByReportId: { $exists: false },
				...(input.excludedVocaIds.length === 0 ? {} : { _id: { $nin: input.excludedVocaIds } })
			})
				.sort({ utilityScore: -1, originKey: 1 })
				.limit(PRESELECTED_VOCAS_PER_LEVEL)
				.select({ originKey: 1, difficultyLevel: 1, utilityScore: 1 })
				.lean()
		)
	);

	return documentsByLevel.flat().map(toPojo<PreselectedVoca>);
}

export async function findNewQuizCandidates(input: {
	currentLevel: number;
	evidenceCount: number;
	excludedVocaIds: string[];
	limit: number;
	targetLang?: VocaEntity['targetLang'];
}): Promise<QuizCandidate[]> {
	if (input.limit <= 0) {
		return [];
	}

	const vocas = await findPreselectedVocas(input);
	const quizCardRefs = await QuizCardModel.find({
		vocaId: { $in: vocas.map((voca) => voca._id) },
		'examples.0': { $exists: true }
	})
		.select({ vocaId: 1 })
		.lean();
	const vocaIdsWithExamples = new Set(quizCardRefs.map((quizCard) => quizCard.vocaId));
	const candidates = vocas.filter((voca) => vocaIdsWithExamples.has(voca._id));
	const randomOrderByVocaId = new Map(candidates.map((voca) => [voca._id, Math.random()]));
	const compareRandomOrder = (left: PreselectedVoca, right: PreselectedVoca): number =>
		(randomOrderByVocaId.get(left._id) ?? 0) - (randomOrderByVocaId.get(right._id) ?? 0) ||
		left.originKey.localeCompare(right.originKey);
	const byUtilityAndDistance = (left: PreselectedVoca, right: PreselectedVoca): number =>
		(right.utilityScore ?? 0) - (left.utilityScore ?? 0) ||
		Math.abs((left.difficultyLevel ?? input.currentLevel) - input.currentLevel) -
			Math.abs((right.difficultyLevel ?? input.currentLevel) - input.currentLevel) ||
		compareRandomOrder(left, right);
	const byDistanceAndUtility = (left: PreselectedVoca, right: PreselectedVoca): number =>
		Math.abs((left.difficultyLevel ?? input.currentLevel) - input.currentLevel) -
			Math.abs((right.difficultyLevel ?? input.currentLevel) - input.currentLevel) ||
		(right.utilityScore ?? 0) - (left.utilityScore ?? 0) ||
		compareRandomOrder(left, right);
	const fallback = [...candidates].sort(byDistanceAndUtility);
	const candidatesByDifficulty = new Map<number, PreselectedVoca[]>();
	for (const candidate of candidates) {
		if (candidate.difficultyLevel == null) continue;
		const group = candidatesByDifficulty.get(candidate.difficultyLevel) ?? [];
		group.push(candidate);
		candidatesByDifficulty.set(candidate.difficultyLevel, group);
	}
	const selected = calculateQuizDifficultyQuotas(input.currentLevel, input.limit).flatMap(
		({ difficultyLevel, count }) =>
			(candidatesByDifficulty.get(difficultyLevel) ?? []).sort(byUtilityAndDistance).slice(0, count)
	);
	const quotaSelectedVocaIds = new Set(selected.map((voca) => voca._id));
	const additional = fallback
		.filter((voca) => !quotaSelectedVocaIds.has(voca._id))
		.slice(0, input.limit - selected.length);
	const selectedVocas = [...selected, ...additional];

	if (selectedVocas.length === 0) return [];

	const selectedVocaIds = selectedVocas.map((voca) => voca._id);
	const [vocaDocuments, quizCards] = await Promise.all([
		VocaModel.find({ _id: { $in: selectedVocaIds } }).lean(),
		QuizCardModel.find({
			vocaId: { $in: selectedVocaIds },
			'examples.0': { $exists: true }
		}).lean()
	]);
	const vocaById = new Map(
		vocaDocuments.map((voca) => {
			const entity = toPojo<VocaEntity>(voca);
			return [entity._id, entity];
		})
	);
	const quizCardByVocaId = new Map(
		quizCards.map((quizCard) => [quizCard.vocaId, toPojo<QuizCardEntity>(quizCard)])
	);

	return selectedVocas.flatMap((selectedVoca) => {
		const voca = vocaById.get(selectedVoca._id);
		const quizCard = quizCardByVocaId.get(selectedVoca._id);
		return voca == null || quizCard == null ? [] : [{ voca, quizCard }];
	});
}

export async function createQuizCard(quizCardData: QuizCardCreate): Promise<QuizCardEntity> {
	const document = await QuizCardModel.create(quizCardData);
	return toPojo(document.toObject());
}

export async function saveQuizCard(currentQuizCard: QuizCardEntity): Promise<QuizCardEntity> {
	const { _id, createdAt: _createdAt, updatedAt: _updatedAt, ...quizCardData } = currentQuizCard;
	const document = await QuizCardModel.findOneAndUpdate(
		{ _id },
		{ $set: toPojo(quizCardData) },
		{ returnDocument: 'after' }
	).lean();

	if (document == null) {
		throw new Error(`Quiz card not found: ${_id}`);
	}

	return toPojo(document);
}

export async function findQuizCardsByVocaIds(vocaIds: string[]): Promise<QuizCardEntity[]> {
	const documents = await QuizCardModel.find({ vocaId: { $in: vocaIds } }).lean();
	return documents.map(toPojo<QuizCardEntity>);
}
