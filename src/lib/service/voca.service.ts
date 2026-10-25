import type { PartOfSpeech, Voca, VocaCreate } from '$lib/shared/types/voca.type';

import { normalizeSourceText, normalizeTargetText } from '$lib/repositories/voca.repository';
import { MAX_LEVEL, MIN_LEVEL } from '$lib/shared/types/general.type';
import { clampNumber, roundTo2 } from '$lib/shared/utils/general.util';

const DIFFICULTY_PROBABILITY_SCALE = 1.25;
const DIFFICULTY_BASELINE_PROBABILITY = 0.8;
const DIFFICULTY_BASELINE_LOGIT = Math.log(
	DIFFICULTY_BASELINE_PROBABILITY / (1 - DIFFICULTY_BASELINE_PROBABILITY)
);
const DIFFICULTY_LEARNING_RATE = 1.2;
const DIFFICULTY_INITIAL_DAMPING = 8;
const DIFFICULTY_DECAY_EXPONENT = 0.6;

type CustomVocaInput = {
	originKey: string;
	createdByUserId?: string;
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: PartOfSpeech;
	targetLang: Voca['targetLang'];
	targetText: string;
	targetDefinition: string;
	difficultyLevel: number | null;
	utilityScore: number | null;
};

export function buildCustomVocaCreate(input: CustomVocaInput): VocaCreate {
	return {
		originKey: input.originKey,
		createdByUserId: input.createdByUserId,
		sourceText: normalizeSourceText(input.sourceText),
		sourceDefinition: input.sourceDefinition,
		partOfSpeech: input.partOfSpeech,
		targetLang: input.targetLang,
		targetText: input.targetText,
		normalizedTargetText: normalizeTargetText(input.targetText, input.targetLang),
		targetDefinition: input.targetDefinition,
		difficultyLevel: input.difficultyLevel,
		utilityScore: input.utilityScore
	};
}

export function applyGeneratedMetadata(
	currentVoca: Voca,
	difficultyLevel: number,
	utilityScore: number
): Voca {
	return {
		...currentVoca,
		difficultyLevel: currentVoca.difficultyLevel ?? difficultyLevel,
		utilityScore: currentVoca.utilityScore ?? utilityScore
	};
}

export function calculateAdjustedDifficulty(
	currentDifficultyLevel: number,
	userLevel: number,
	isCorrect: boolean,
	previousSampleCount: number
): number {
	const logit =
		(userLevel - currentDifficultyLevel) / DIFFICULTY_PROBABILITY_SCALE + DIFFICULTY_BASELINE_LOGIT;
	const expectedCorrectRate = 1 / (1 + Math.exp(-logit));
	const actualResult = isCorrect ? 1 : 0;
	const learningRate =
		DIFFICULTY_LEARNING_RATE /
		Math.pow(
			Math.max(0, previousSampleCount) + DIFFICULTY_INITIAL_DAMPING,
			DIFFICULTY_DECAY_EXPONENT
		);

	return roundTo2(
		clampNumber(
			currentDifficultyLevel + learningRate * (expectedCorrectRate - actualResult),
			MIN_LEVEL,
			MAX_LEVEL
		)
	);
}
