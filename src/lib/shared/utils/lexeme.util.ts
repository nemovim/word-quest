function normalize(value: string): string {
	return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function inflections(word: string, partOfSpeech: string): Set<string> {
	const forms = new Set([word]);

	if (partOfSpeech === 'noun' || partOfSpeech === 'verb') {
		forms.add(`${word}s`);
		forms.add(`${word}es`);

		if (/[^aeiou]y$/.test(word)) {
			forms.add(`${word.slice(0, -1)}ies`);
		}
	}

	if (partOfSpeech === 'verb') {
		forms.add(`${word}ed`);
		forms.add(`${word}ing`);

		if (word.endsWith('e')) {
			forms.add(`${word}d`);
			forms.add(`${word.slice(0, -1)}ing`);
		}

		if (/[^aeiou]y$/.test(word)) {
			forms.add(`${word.slice(0, -1)}ied`);
		}

		if (/[^aeiou][aeiou][^aeiouwxy]$/.test(word)) {
			forms.add(`${word}${word.at(-1)}ed`);
			forms.add(`${word}${word.at(-1)}ing`);
		}
	}

	return forms;
}

export function isEnglishLexemeSurface(
	targetText: string,
	answerSurface: string,
	partOfSpeech: string
): boolean {
	const targetTokens = normalize(targetText).split(' ');
	const answerTokens = normalize(answerSurface).split(' ');

	if (targetTokens.length !== answerTokens.length) {
		return false;
	}

	let changedTokenCount = 0;

	for (let index = 0; index < targetTokens.length; index += 1) {
		const targetToken = targetTokens[index];
		const answerToken = answerTokens[index];

		if (targetToken === answerToken) {
			continue;
		}

		if (!inflections(targetToken, partOfSpeech).has(answerToken)) {
			return false;
		}

		changedTokenCount += 1;
	}

	return changedTokenCount <= 1;
}
