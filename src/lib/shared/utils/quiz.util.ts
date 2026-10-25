import type { QuizExample } from '$lib/shared/types/quiz-card.type';

export function shuffleItems<T>(items: T[], random = Math.random): T[] {
	const shuffled = [...items];

	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
	}

	return shuffled;
}

export function pickWeightedQuizExample(
	examples: QuizExample[],
	exampleScoreById: Partial<Record<string, number>>,
	lastQuizExampleId?: string,
	randomValue = Math.random()
): QuizExample {
	if (examples.length === 0) {
		throw new Error('Quiz example does not exist.');
	}

	const preferredExamples =
		lastQuizExampleId == null
			? examples
			: examples.filter((quizExample) => quizExample._id !== lastQuizExampleId);
	const candidates = preferredExamples.length > 0 ? preferredExamples : examples;

	const weights = candidates.map((quizExample) => 1 + (exampleScoreById[quizExample._id] ?? 0));
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
	let cursor = totalWeight * randomValue;

	for (const [index, quizExample] of candidates.entries()) {
		cursor -= weights[index];

		if (cursor <= 0) {
			return quizExample;
		}
	}

	return candidates.at(-1) as QuizExample;
}
