export function resolveGenerationModel(value: string | undefined): string {
	return value?.trim() || 'openai/gpt-6-luna';
}

export function getDecisionModels() {
	const primary = process.env.OPENROUTER_DECISION_MODEL?.trim() || 'perplexity/pplx-decider-v1.2';
	const secondary = process.env.OPENROUTER_REVIEW_MODEL?.trim() || 'typesafe/jev-1.14';
	if (primary === secondary)
		throw new Error('OPENROUTER_REVIEW_MODEL must differ from OPENROUTER_DECISION_MODEL.');
	return { primary, secondary };
}
