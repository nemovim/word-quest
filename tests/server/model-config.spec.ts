import { afterEach, expect, it, vi } from 'vitest';

import { getDecisionModels, resolveGenerationModel } from '$lib/server/model-config';

afterEach(() => vi.unstubAllEnvs());

it('uses the shared text model and defaults to GPT-6 Luna', () => {
	expect(resolveGenerationModel(' custom/text ')).toBe('custom/text');
	expect(resolveGenerationModel('  ')).toBe('openai/gpt-6-luna');
});

it('uses the configured decision models for scoring', () => {
	vi.stubEnv('OPENROUTER_DECISION_MODEL', ' test/primary ');
	vi.stubEnv('OPENROUTER_REVIEW_MODEL', ' test/secondary ');
	vi.stubEnv('OPENROUTER_EXAMPLE_REVIEW_MODEL', 'obsolete/ignored');
	expect(getDecisionModels()).toEqual({ primary: 'test/primary', secondary: 'test/secondary' });
});

it('rejects an identical primary and secondary model', () => {
	vi.stubEnv('OPENROUTER_DECISION_MODEL', 'test/model');
	vi.stubEnv('OPENROUTER_REVIEW_MODEL', 'test/model');
	expect(() => getDecisionModels()).toThrow('must differ');
});
