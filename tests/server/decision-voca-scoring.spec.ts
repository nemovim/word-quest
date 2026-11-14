import { afterEach, expect, it, vi } from 'vitest';

import {
	scoreVocaWithDecisionModel,
	UncertainVocaScoreError
} from '$lib/server/decision-voca-scoring';

const input = {
	sourceText: '사과',
	sourceDefinition: '과일',
	partOfSpeech: 'noun',
	targetText: 'apple',
	targetDefinition: 'fruit'
};
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

it('maps decision-model zero-based scores and validity to the existing vocabulary scales', async () => {
	vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
	vi.stubEnv('OPENROUTER_DECISION_MODEL', 'typesafe/test-model');
	const fetchMock = vi.fn().mockResolvedValue(
		new Response(
			JSON.stringify({
				answers: {
					valid: { type: 'noul', noul: 0.9 },
					difficulty: {
						type: 'score',
						score: 1.234,
						confidence: 0.9,
						probabilities: { '1': 0.7, '2': 0.3 }
					},
					koreanUsage: { type: 'score', score: 3.94, confidence: 0.8 },
					targetUsage: { type: 'score', score: 2.86, confidence: 0.7 }
				}
			}),
			{ status: 200 }
		)
	);
	vi.stubGlobal('fetch', fetchMock);
	expect(await scoreVocaWithDecisionModel(input)).toMatchObject({
		difficultyLevel: 2.23,
		koreanUsage: 4.9,
		englishUsage: 3.9,
		utilityScore: 3.9,
		attempts: [
			{
				scores: { difficulty: 2.23, koreanUsage: 4.9, targetUsage: 3.9 },
				probabilities: { difficulty: { '1': 0.7, '2': 0.3 } }
			}
		]
	});
	const request = JSON.parse(fetchMock.mock.calls[0][1].body);
	expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions');
	expect(request.model).toBe('typesafe/test-model');
	expect(request.questions.difficulty.criteria).toHaveLength(10);
	expect(request.questions.valid.instructions).toContain('at least one ordinary context');
	expect(request.questions.valid.instructions).toContain('omission of an essential modifier');
	expect(request.state).toEqual(input);
});

function decision(valid: number, confidence: number, score = 1) {
	return new Response(
		JSON.stringify({
			answers: {
				valid: { type: 'noul', noul: valid },
				difficulty: { type: 'score', score, confidence },
				koreanUsage: { type: 'score', score, confidence },
				targetUsage: { type: 'score', score, confidence }
			}
		})
	);
}

it('accepts a score at the configured confidence threshold with one call', async () => {
	vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
	vi.stubEnv('OPENROUTER_DECISION_MODEL', 'test/primary');
	vi.stubEnv('OPENROUTER_REVIEW_MODEL', 'test/reviewer');
	vi.stubEnv('VOCA_SCORE_MIN_CONFIDENCE', '0.35');
	const fetchMock = vi.fn().mockResolvedValueOnce(decision(0.9, 0.35, 2));
	vi.stubGlobal('fetch', fetchMock);
	const result = await scoreVocaWithDecisionModel(input);
	expect(result.difficultyLevel).toBe(3);
	expect(result.attempts).toHaveLength(1);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('test/primary');
});

it('defers low confidence after the first model without a second call', async () => {
	vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
	vi.stubEnv('VOCA_SCORE_MIN_CONFIDENCE', '0.35');
	const fetchMock = vi.fn().mockResolvedValueOnce(decision(0.95, 0.34));
	vi.stubGlobal('fetch', fetchMock);
	await expect(scoreVocaWithDecisionModel(input)).rejects.toBeInstanceOf(UncertainVocaScoreError);
	expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('defers an uncertain translation even when scores are confident', async () => {
	vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
	const fetchMock = vi.fn().mockResolvedValueOnce(decision(0.5, 0.9));
	vi.stubGlobal('fetch', fetchMock);
	await expect(scoreVocaWithDecisionModel(input)).rejects.toBeInstanceOf(UncertainVocaScoreError);
	expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('excludes a confidently invalid translation even when score confidence is low', async () => {
	vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
	vi.stubEnv('VOCA_VALIDITY_MIN_CONFIDENCE', '0.8');
	vi.stubEnv('VOCA_SCORE_MIN_CONFIDENCE', '0.35');
	const fetchMock = vi.fn().mockResolvedValueOnce(decision(0.1, 0.1));
	vi.stubGlobal('fetch', fetchMock);
	expect(await scoreVocaWithDecisionModel(input)).toMatchObject({ isValid: 0, utilityScore: 0 });
	expect(fetchMock).toHaveBeenCalledOnce();
});

it('rejects malformed scores instead of saving them', async () => {
	vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					answers: {
						valid: { type: 'noul', noul: 0.9 },
						difficulty: { type: 'score', score: 10 }
					}
				})
			)
		)
	);
	await expect(scoreVocaWithDecisionModel(input)).rejects.toThrow(
		'Invalid decision difficulty score'
	);
});
