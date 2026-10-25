const DEFAULT_OPENROUTER_MODEL = 'mistralai/mistral-small-2603';

export function getOpenRouterModel(): string {
	return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}
