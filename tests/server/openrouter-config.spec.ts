import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOpenRouterModel } from '../../src/lib/server/openrouter-config';

describe('OpenRouter model configuration', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('uses the single configured model for every OpenRouter caller', () => {
		vi.stubEnv('OPENROUTER_MODEL', '  provider/shared-model  ');

		expect(getOpenRouterModel()).toBe('provider/shared-model');
	});

	it('uses the shared default when the model is empty', () => {
		vi.stubEnv('OPENROUTER_MODEL', '   ');

		expect(getOpenRouterModel()).toBe('mistralai/mistral-small-2603');
	});
});
