import {
	LANGUAGE_CODES,
	QUIZ_TEMPLATE_SLOT,
	type LanguageCode
} from '$lib/shared/types/general.type';

export function normalizeAnswer(answerText: string, answerLang: LanguageCode): string {
	const trimmed = answerText.trim().replace(/\s+/g, ' ');

	if (answerLang === LANGUAGE_CODES.EN) {
		return trimmed.toLowerCase();
	}

	return trimmed;
}

export function fillQuizTemplate(template: string, fillText: string): string {
	return template.replace(QUIZ_TEMPLATE_SLOT, fillText);
}

export function getAnswerWordCount(fillText: string): number {
	const trimmed = fillText.trim();
	return trimmed === '' ? 1 : trimmed.split(/\s+/).length;
}

export function getAnswerInitialHint(fillText: string): string {
	return fillText
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => {
			const characters = Array.from(word);
			const initial = characters.find((character) => /[\p{L}\p{N}]/u.test(character));
			return `${initial ?? characters[0]}…`;
		})
		.join(' ');
}

export function splitQuizTemplate(template: string): {
	before: string;
	after: string;
} {
	const [before, after] = template.split(QUIZ_TEMPLATE_SLOT);

	return {
		before: before ?? '',
		after: after ?? ''
	};
}

export function getCloseAnswerDistance(
	answer: string,
	target: string,
	language: LanguageCode
): number | null {
	const source = Array.from(normalizeAnswer(answer, language).normalize('NFC'));
	const expected = Array.from(normalizeAnswer(target, language).normalize('NFC'));
	const limit = Math.min(2, Math.floor(expected.length / 3));
	if (!source.length || !limit || Math.abs(source.length - expected.length) > limit) return null;
	let previous = Array.from({ length: expected.length + 1 }, (_, i) => i);
	for (let row = 1; row <= source.length; row += 1) {
		const current = [row];
		for (let column = 1; column <= expected.length; column += 1) {
			current[column] = Math.min(
				current[column - 1] + 1,
				previous[column] + 1,
				previous[column - 1] + (source[row - 1] === expected[column - 1] ? 0 : 1)
			);
		}
		previous = current;
	}
	const distance = previous[expected.length];
	return distance > 0 && distance <= limit ? distance : null;
}
