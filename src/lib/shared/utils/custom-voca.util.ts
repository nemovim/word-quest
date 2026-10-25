import type { LanguageCode } from '$lib/shared/types/general.type';
import type { Voca } from '$lib/shared/types/voca.type';

import { KOREAN_LANGUAGE_CODE } from '$lib/shared/types/general.type';
import { normalizeAnswer } from '$lib/shared/utils/answer.util';

const CUSTOM_ORIGIN_PREFIX = 'custom:';

function escapeOriginPart(value: string): string {
	return value.replaceAll('%', '%25').replaceAll(':', '%3A');
}

function getCustomWordPrefix(sourceText: string): string {
	return `${CUSTOM_ORIGIN_PREFIX}${escapeOriginPart(normalizeAnswer(sourceText, KOREAN_LANGUAGE_CODE))}:`;
}

export function isCustomOriginKey(originKey: string): boolean {
	return originKey.startsWith(CUSTOM_ORIGIN_PREFIX);
}

export function getCustomSenseNumber(originKey: string, sourceText: string): number | null {
	const prefix = getCustomWordPrefix(sourceText);

	if (!originKey.startsWith(prefix)) {
		return null;
	}

	const sensePart = originKey.slice(prefix.length).split(':', 1)[0];
	const senseNumber = Number(sensePart);
	return Number.isInteger(senseNumber) && senseNumber > 0 ? senseNumber : null;
}

export function getNextCustomSenseNumber(sourceText: string, vocas: Voca[]): number {
	const currentNumbers = vocas
		.map((voca) => getCustomSenseNumber(voca.originKey, sourceText))
		.filter((senseNumber): senseNumber is number => senseNumber != null);

	return Math.max(0, ...currentNumbers) + 1;
}

export function buildCustomOriginKey(input: {
	sourceText: string;
	senseNumber: number;
	targetLang: LanguageCode;
	targetText: string;
}): string {
	return [
		'custom',
		escapeOriginPart(normalizeAnswer(input.sourceText, KOREAN_LANGUAGE_CODE)),
		String(input.senseNumber),
		input.targetLang,
		escapeOriginPart(normalizeAnswer(input.targetText, input.targetLang))
	].join(':');
}
