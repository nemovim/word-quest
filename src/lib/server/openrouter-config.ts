import { env } from '$env/dynamic/private';

const DEFAULT_OPENROUTER_MODEL = 'mistralai/mistral-small-2603';

export function getOpenRouterModel(): string {
	return env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}
