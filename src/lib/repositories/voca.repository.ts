import type { VocaEntity, VocaCreate } from '$lib/shared/types/voca.type';

import VocaModel from '$lib/models/voca.model';
import { KOREAN_LANGUAGE_CODE, LANGUAGE_CODES } from '$lib/shared/types/general.type';
import { normalizeAnswer } from '$lib/shared/utils/answer.util';
import { toPojo } from '$lib/shared/utils/general.util';

const VOCA_SEARCH_RESULT_LIMIT = 100;
const ENGLISH_SEARCH_CHARACTER_PATTERN = /[a-z0-9]/i;

export function normalizeSourceText(sourceText: string): string {
	return normalizeAnswer(sourceText, KOREAN_LANGUAGE_CODE);
}

export function normalizeTargetText(
	targetText: string,
	targetLang: VocaEntity['targetLang']
): string {
	return normalizeAnswer(targetText, targetLang);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildTargetTextSearch(
	targetText: string,
	targetLang: VocaEntity['targetLang']
): string | RegExp {
	const normalizedTargetText = normalizeTargetText(targetText, targetLang);

	if (targetLang !== LANGUAGE_CODES.EN) {
		return normalizedTargetText;
	}

	return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTargetText)}($|[^a-z0-9])`);
}

async function findVocaById(vocaId: string): Promise<VocaEntity | null> {
	const raw = await VocaModel.findById(vocaId).lean();
	return raw == null ? null : toPojo(raw);
}

export async function getVocaById(vocaId: string): Promise<VocaEntity> {
	const currentVoca = await findVocaById(vocaId);

	if (currentVoca == null) {
		throw new Error(`Voca not found: ${vocaId}`);
	}

	return currentVoca;
}

export async function findVocasBySourceText(
	targetLang: VocaEntity['targetLang'],
	sourceText: string
): Promise<VocaEntity[]> {
	const normalizedSourceText = normalizeSourceText(sourceText);
	const targetTextSearch = buildTargetTextSearch(sourceText, targetLang);
	const shouldSearchTargetText =
		targetLang !== LANGUAGE_CODES.EN || ENGLISH_SEARCH_CHARACTER_PATTERN.test(normalizedSourceText);
	const documents = await VocaModel.find({
		targetLang,
		...(shouldSearchTargetText
			? { $or: [{ sourceText: normalizedSourceText }, { normalizedTargetText: targetTextSearch }] }
			: { sourceText: normalizedSourceText })
	})
		.sort({ normalizedTargetText: 1, originKey: 1 })
		.limit(VOCA_SEARCH_RESULT_LIMIT)
		.lean();

	return documents.map(toPojo<VocaEntity>);
}

export async function findVocasByPair(
	targetLang: VocaEntity['targetLang'],
	sourceText: string,
	targetText: string
): Promise<VocaEntity[]> {
	const documents = await VocaModel.find({
		targetLang,
		sourceText: normalizeSourceText(sourceText),
		normalizedTargetText: normalizeTargetText(targetText, targetLang)
	})
		.sort({ originKey: 1 })
		.lean();

	return documents.map(toPojo<VocaEntity>);
}

export async function createVoca(vocaData: VocaCreate): Promise<VocaEntity> {
	const document = await VocaModel.create(vocaData);
	return toPojo(document.toObject());
}

export async function saveVoca(currentVoca: VocaEntity): Promise<VocaEntity> {
	const { _id, ...vocaData } = currentVoca;
	const document = await VocaModel.findOneAndUpdate(
		{ _id },
		{ $set: toPojo(vocaData) },
		{ returnDocument: 'after' }
	).lean();

	if (document == null) {
		throw new Error(`Voca not found: ${_id}`);
	}

	return toPojo(document);
}

export async function updateVocaDifficultyIfCurrent(
	vocaId: string,
	currentDifficultyLevel: number,
	nextDifficultyLevel: number
): Promise<VocaEntity | null> {
	const document = await VocaModel.findOneAndUpdate(
		{ _id: vocaId, difficultyLevel: currentDifficultyLevel },
		{ $set: { difficultyLevel: nextDifficultyLevel } },
		{ returnDocument: 'after' }
	).lean();

	return document == null ? null : toPojo(document);
}

export async function findVocaByIds(vocaIds: string[]): Promise<VocaEntity[]> {
	const documents = await VocaModel.find({ _id: { $in: vocaIds } }).lean();
	return documents.map(toPojo<VocaEntity>);
}

export async function findPermanentlyExcludedVocaIds(): Promise<string[]> {
	const vocaIds = await VocaModel.distinct('_id', {
		quizExcludedByReportId: { $exists: true }
	});
	return vocaIds.map(String);
}
