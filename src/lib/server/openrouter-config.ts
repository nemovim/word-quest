import { resolveGenerationModel } from './model-config';

import { env } from '$env/dynamic/private';

export function getOpenRouterModel(): string {
	return resolveGenerationModel(env.OPENROUTER_MODEL);
}
