import { OpenRouter } from '@openrouter/sdk';

import { getOpenRouterModel } from './openrouter-config';

import { env } from '$env/dynamic/private';

type OpenRouterMessage = {
	role: 'developer' | 'system' | 'user' | 'assistant';
	content: string;
};

type JsonSchema = Record<string, unknown>;

function getClient(): OpenRouter {
	if (env.OPENROUTER_API_KEY == null || env.OPENROUTER_API_KEY.trim() === '') {
		throw new Error('OPENROUTER_API_KEY is required.');
	}

	return new OpenRouter({
		apiKey: env.OPENROUTER_API_KEY,
		timeoutMs: 15_000,
		retryConfig: {
			strategy: 'backoff',
			backoff: {
				initialInterval: 400,
				maxInterval: 2_000,
				exponent: 1.5,
				maxElapsedTime: 6_000
			},
			retryConnectionErrors: true
		}
	});
}

function getStatusCode(error: unknown): number | undefined {
	if (typeof error !== 'object' || error == null || !('statusCode' in error)) return undefined;
	return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

function getRecordProperty(value: unknown, property: string): unknown {
	return typeof value === 'object' && value != null && property in value
		? (value as Record<string, unknown>)[property]
		: undefined;
}

function getProviderErrorDetails(error: unknown): Record<string, unknown> {
	const providerError = getRecordProperty(error, 'error');
	const metadata = getRecordProperty(providerError, 'metadata');
	const providerName = getRecordProperty(metadata, 'provider_name');
	const raw = getRecordProperty(metadata, 'raw');
	const responseBody = getRecordProperty(error, 'body');
	const openRouterMetadata = getRecordProperty(error, 'openRouterMetadata');

	return {
		...(typeof providerName === 'string' ? { providerName } : {}),
		...(typeof raw === 'string' ? { providerError: raw.slice(0, 2_000) } : {}),
		...(typeof responseBody === 'string' ? { responseBody: responseBody.slice(0, 2_000) } : {}),
		...(openRouterMetadata == null ? {} : { openRouterMetadata })
	};
}

export function getOpenRouterUserMessage(error: unknown): string {
	const statusCode = getStatusCode(error);

	if (error instanceof Error && error.message === 'OPENROUTER_API_KEY is required.') {
		return 'OpenRouter API 키가 설정되지 않았습니다.';
	}
	if (statusCode === 401) return 'OpenRouter API 키가 올바르지 않습니다.';
	if (statusCode === 402) return 'OpenRouter 크레딧이 부족합니다.';
	if (statusCode === 403) return 'OpenRouter 요청 권한 또는 사용 한도를 확인해 주세요.';
	if ([400, 404, 413, 422].includes(statusCode ?? 0)) {
		return '설정한 AI 모델이나 요청 형식을 확인해 주세요.';
	}
	if ([408, 429, 500, 502, 503, 524, 529].includes(statusCode ?? 0)) {
		return 'AI 제공자가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.';
	}
	if (error instanceof SyntaxError) {
		return 'AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.';
	}

	return 'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function logOpenRouterError(error: unknown): void {
	const details =
		error instanceof Error
			? {
					name: error.name,
					message: error.message,
					statusCode: getStatusCode(error),
					...getProviderErrorDetails(error)
				}
			: { errorType: typeof error };
	console.error('OpenRouter request failed.', details);
}

function readJsonContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.map((item) => {
				if (typeof item !== 'object' || item == null || !('text' in item)) {
					return '';
				}

				return typeof item.text === 'string' ? item.text : '';
			})
			.join('');
	}

	return '';
}

export async function sendOpenRouterJson<T>(options: {
	schemaName: string;
	schema: JsonSchema;
	messages: OpenRouterMessage[];
}): Promise<T> {
	try {
		const response = await getClient().chat.send({
			xOpenRouterMetadata: 'enabled',
			chatRequest: {
				stream: false,
				model: getOpenRouterModel(),
				responseFormat: {
					type: 'json_schema',
					jsonSchema: {
						name: options.schemaName,
						strict: true,
						schema: options.schema
					}
				},
				messages: options.messages
			}
		});

		if (!('choices' in response)) {
			throw new Error('OpenRouter returned an unexpected streaming response.');
		}

		const content = readJsonContent(response.choices[0]?.message?.content);
		if (content.trim() === '') throw new SyntaxError('OpenRouter returned empty JSON content.');
		return JSON.parse(content) as T;
	} catch (error) {
		logOpenRouterError(error);
		throw new Error(getOpenRouterUserMessage(error), { cause: error });
	}
}
