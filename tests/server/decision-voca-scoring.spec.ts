import { afterEach, expect, it, vi } from 'vitest';

import { scoreVocaWithDecisionModel } from '$lib/server/decision-voca-scoring';

const input = {
	sourceText: '사과',
	sourceDefinition: '과일',
	partOfSpeech: 'noun',
	targetText: 'apple',
	targetDefinition: 'fruit'
};
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

it('retries a rate-limited decision request', async () => {
	vi.useFakeTimers();
	vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
		.mockResolvedValueOnce(decision(0.9, 0.8, 2));
	vi.stubGlobal('fetch', fetchMock);
	const result = scoreVocaWithDecisionModel(input);
	await vi.runAllTimersAsync();
	expect((await result).isValid).toBe(1);
	expect(fetchMock).toHaveBeenCalledTimes(2);
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
	expect(request.questions.valid.instructions).toContain('natural and educationally useful cue');
	expect(request.questions.valid.instructions).toContain(
		'Reject if the target omits essential meaning'
	);
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

it.each([
	[0.699, 0, 0],
	[0.7, 1, 3]
])(
	'applies the learning suitability threshold at %s regardless of score confidence',
	async (probability, isValid, utilityScore) => {
		vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(decision(probability, 0.1, 2)));
		const result = await scoreVocaWithDecisionModel(input);
		expect(result).toMatchObject({ isValid, utilityScore, difficultyLevel: 3 });
		expect(result.attempts[0].confidence.difficulty).toBe(0.1);
	}
);

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
