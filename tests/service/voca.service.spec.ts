import { describe, expect, it } from 'vitest';

import { makeVoca } from '../helpers/factories';

import {
	applyGeneratedMetadata,
	buildCustomVocaCreate,
	calculateAdjustedDifficulty
} from '$lib/service/voca.service';
import { LANGUAGE_CODES } from '$lib/shared/types/general.type';
import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';

describe('voca.service', () => {
	it('builds a custom voca payload with normalized source and target text', () => {
		const vocaCreate = buildCustomVocaCreate({
			originKey: 'custom:test',
			createdByUserId: 'user-1',
			sourceText: '  source-word  ',
			sourceDefinition: 'source definition',
			partOfSpeech: PARTS_OF_SPEECH.VERB,
			targetLang: LANGUAGE_CODES.EN,
			targetText: ' Go ',
			targetDefinition: 'to move to another place',
			difficultyLevel: 2,
			utilityScore: 5
		});

		expect(vocaCreate).toMatchObject({
			originKey: 'custom:test',
			createdByUserId: 'user-1',
			sourceText: 'source-word',
			sourceDefinition: 'source definition',
			partOfSpeech: PARTS_OF_SPEECH.VERB,
			targetLang: LANGUAGE_CODES.EN,
			targetText: ' Go ',
			normalizedTargetText: 'go',
			targetDefinition: 'to move to another place',
			difficultyLevel: 2,
			utilityScore: 5
		});
	});

	it('fills generated metadata only when the current voca is missing it', () => {
		const currentVoca = makeVoca({ _id: 'target', difficultyLevel: null, utilityScore: null });
		const updated = applyGeneratedMetadata(currentVoca, 6, 5);

		expect(updated.difficultyLevel).toBe(6);
		expect(updated.utilityScore).toBe(5);
		expect(
			applyGeneratedMetadata(
				{
					...updated,
					difficultyLevel: 3,
					utilityScore: 4
				},
				8,
				1
			)
		).toMatchObject({
			difficultyLevel: 3,
			utilityScore: 4
		});
	});

	it('adjusts difficulty from first-result surprise and dampens later samples', () => {
		expect(calculateAdjustedDifficulty(3, 3, true, 0)).toBe(2.93);
		expect(calculateAdjustedDifficulty(3, 3, false, 0)).toBe(3.28);
		expect(calculateAdjustedDifficulty(3, 3, false, 100)).toBe(3.06);
	});

	it('keeps adjusted difficulty inside the supported level range', () => {
		expect(calculateAdjustedDifficulty(1, 10, true, 0)).toBe(1);
		expect(calculateAdjustedDifficulty(10, 1, false, 0)).toBe(10);
	});
});
