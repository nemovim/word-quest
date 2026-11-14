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

function threshold(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0 || value > 1)
		throw new Error(`${name} must be between 0 and 1.`);
	return value;
}

async function requestDecision(input: VocaScoringInput, model: string) {
	const key = process.env.OPENROUTER_API_KEY?.trim();
	if (!key) throw new Error('OPENROUTER_API_KEY is required for vocabulary scoring.');
	const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			state: input,
			questions: {
				valid: {
					type: 'noul',
					instructions:
						'In the supplied definitions, is there at least one ordinary context where sourceText and targetText naturally express the same complete intended sense as vocabulary equivalents? Accept a valid shared sense even if either expression has other senses, grammatical variations, or a more common alternative translation. Do not require every sense in a definition to match. Reject a different sense, wrong direction or negation, an unnatural expression, or omission of an essential modifier or other meaning required by the supplied sense. Judge the expressions themselves, not merely whether the definitions describe related topics.'
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
	const isValid = valid.noul >= 0.5 ? 1 : 0;
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
	const minConfidence = threshold('VOCA_SCORE_MIN_CONFIDENCE', 0.35);
	const minValidity = threshold('VOCA_VALIDITY_MIN_CONFIDENCE', 0.8);
	if (minValidity < 0.5) throw new Error('VOCA_VALIDITY_MIN_CONFIDENCE must be at least 0.5.');
	const result = await requestDecision(input, primary);
	const attempts = [result.evidence];
	const probability = result.evidence.validProbability;
	const validityCertain = Math.max(probability, 1 - probability) >= minValidity;
	if (validityCertain && result.score.isValid === 0) return { ...result.score, attempts };
	const scoresCertain = Object.values(result.evidence.confidence).every(
		(confidence) => confidence >= minConfidence
	);
	if (validityCertain && scoresCertain) return { ...result.score, attempts };
	throw new UncertainVocaScoreError(attempts);
}
