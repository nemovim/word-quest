import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOpenRouterModel } from '../../src/lib/server/openrouter-config';

const { env } = vi.hoisted(() => ({ env: { OPENROUTER_MODEL: undefined as string | undefined } }));

vi.mock('$env/dynamic/private', () => ({ env }));

describe('OpenRouter model configuration', () => {
	afterEach(() => {
		env.OPENROUTER_MODEL = undefined;
	});

	it('uses the single configured model for every OpenRouter caller', () => {
		env.OPENROUTER_MODEL = '  provider/shared-model  ';

		expect(getOpenRouterModel()).toBe('provider/shared-model');
	});

	it('uses the shared default when the model is empty', () => {
		env.OPENROUTER_MODEL = '   ';

		expect(getOpenRouterModel()).toBe('mistralai/mistral-small-2603');
	});
});
