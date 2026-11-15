export type VocaScoringInput = {
	sourceText: string;
	sourceDefinition: string;
	partOfSpeech: string;
	targetText: string;
	targetDefinition: string;
	targetLang?: string;
};

const usageLevels = [
	'Obsolete or extremely rare in modern speech and writing.',
	'Uncommon, limited to specialized contexts, or rarely actively used.',
	'Regularly useful in some ordinary contexts.',
	'Common and broadly practical in ordinary contexts.',
	'Core everyday vocabulary used very frequently across ordinary contexts.'
];
const difficultyLevels = [
	'A foundational expression learned at the very beginning of study of the target language.',
	'A basic beginner expression used in familiar everyday situations.',
	'An elementary expression encountered in common situations.',
	'An accessible general expression learned after elementary vocabulary.',
	'An intermediate expression requiring some familiarity with the target language.',
	'An intermediate expression with less familiar form or usage.',
	'An advanced expression that many intermediate learners do not readily produce.',
	'A demanding advanced expression with unfamiliar form or restricted usage.',
	'A very difficult expression encountered mainly in advanced or specialized material.',
	'An exceptionally difficult expression requiring expert or highly specialized knowledge.'
];

type DecisionEvidence = {
	model: string;
	validProbability: number;
	confidence: { difficulty: number; koreanUsage: number; targetUsage: number };
	scores: { difficulty: number; koreanUsage: number; targetUsage: number };
	probabilities: Record<string, Record<string, number>>;
};

export class UncertainVocaScoreError extends Error {
	readonly attempts: DecisionEvidence[];
	constructor(attempts: DecisionEvidence[]) {
		super('단어 점수의 확신도가 낮아 평가를 보류했습니다.');
		this.name = 'UncertainVocaScoreError';
		this.attempts = attempts;
	}
}

async function requestDecision(input: VocaScoringInput, model: string) {
	const key = process.env.OPENROUTER_API_KEY?.trim();
	if (!key) throw new Error('OPENROUTER_API_KEY is required for vocabulary scoring.');
	const request = () =>
		fetch('https://openrouter.ai/api/alpha/decisions', {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model,
				state: input,
				questions: {
					valid: {
						type: 'noul',
						instructions:
							'For Korean speakers studying the target language, is the exact Korean source expression, in its supplied source sense, a natural and educationally useful cue for learning the exact target expression in its supplied target sense? Both expressions must share the complete intended sense in an ordinary, plausible usage. Reject if the target omits essential meaning or is unnatural, or if the Korean cue is an obscure, strained, indirect, figurative or unusual way to cue the target expression and a normal Korean learner would not naturally connect them. A shared dictionary definition alone does not make a good learning pair. Do not reject a specialized word solely because its topic is specialized when it is an accurate and natural cue for its exact meaning. Judge the expressions themselves, not just the similarity of definitions.'
					},
					difficulty: {
						type: 'score',
						instructions:
							'How difficult is the exact target expression and sense for a Korean learner to recall and use? Judge the target expression, not the obscurity of the source concept.',
						criteria: difficultyLevels
					},
					koreanUsage: {
						type: 'score',
						instructions:
							'How often do modern Korean speakers actively use the source expression in the exact supplied source sense? Do not rate other senses or mere recognizability.',
						criteria: usageLevels
					},
					targetUsage: {
						type: 'score',
						instructions:
							'How often do speakers actively use the target expression in the exact supplied target sense?',
						criteria: usageLevels
					}
				}
			}),
			signal: AbortSignal.timeout(30000)
		});
	let response = await request();
	for (let attempt = 0; response.status === 429 && attempt < 6; attempt++) {
		const retryAfter = response.headers.get('retry-after');
		const seconds = retryAfter == null ? NaN : Number(retryAfter);
		const delay =
			Number.isFinite(seconds) && seconds >= 0
				? Math.min(seconds * 1000, 60000)
				: Math.min(1000 * 2 ** attempt, 30000);
		await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * 500));
		response = await request();
	}
	if (!response.ok) throw new Error(`Decision scoring request failed (${response.status}).`);
	const data = (await response.json()) as {
		model?: string;
		answers?: Record<
			string,
			{
				type?: string;
				score?: number;
				confidence?: number;
				noul?: number;
				probabilities?: Record<string, number>;
			}
		>;
	};
	const score = (name: string, max: number, decimals: number) => {
		const answer = data.answers?.[name];
		if (
			answer?.type !== 'score' ||
			typeof answer.score !== 'number' ||
			!Number.isFinite(answer.score) ||
			answer.score < 0 ||
			answer.score > max - 1
		)
			throw new Error(`Invalid decision ${name} score.`);
		if (
			typeof answer.confidence !== 'number' ||
			!Number.isFinite(answer.confidence) ||
			answer.confidence < 0 ||
			answer.confidence > 1
		)
			throw new Error(`Invalid ${name} confidence.`);
		const factor = 10 ** decimals;
		return {
			value: Math.round((answer.score + 1 + Number.EPSILON) * factor) / factor,
			confidence: answer.confidence
		};
	};
	const valid = data.answers?.valid;
	if (
		valid?.type !== 'noul' ||
		typeof valid.noul !== 'number' ||
		!Number.isFinite(valid.noul) ||
		valid.noul < 0 ||
		valid.noul > 1
	)
		throw new Error('Invalid decision validity response.');
	const difficulty = score('difficulty', 10, 2);
	const korean = score('koreanUsage', 5, 1);
	const target = score('targetUsage', 5, 1);
	const isValid = valid.noul >= 0.7 ? 1 : 0;
	return {
		score: {
			difficultyLevel: difficulty.value,
			koreanUsage: korean.value,
			englishUsage: target.value,
			isValid,
			utilityScore: isValid ? Math.min(korean.value, target.value) : 0
		},
		evidence: {
			model: data.model || model,
			validProbability: valid.noul,
			confidence: {
				difficulty: difficulty.confidence,
				koreanUsage: korean.confidence,
				targetUsage: target.confidence
			},
			scores: {
				difficulty: difficulty.value,
				koreanUsage: korean.value,
				targetUsage: target.value
			},
			probabilities: Object.fromEntries(
				['difficulty', 'koreanUsage', 'targetUsage'].flatMap((name) => {
					const probabilities = data.answers?.[name]?.probabilities;
					return probabilities && typeof probabilities === 'object' ? [[name, probabilities]] : [];
				})
			)
		}
	};
}

export async function scoreVocaWithDecisionModel(input: VocaScoringInput) {
	const primary = process.env.OPENROUTER_DECISION_MODEL?.trim() || 'perplexity/pplx-decider-v1.2';
	const result = await requestDecision(input, primary);
	return { ...result.score, attempts: [result.evidence] };
}
