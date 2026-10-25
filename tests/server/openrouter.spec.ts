import { describe, expect, it } from 'vitest';

import { getOpenRouterUserMessage } from '../../src/lib/server/openrouter';

describe('openrouter', () => {
	it.each([
		[401, 'OpenRouter API 키가 올바르지 않습니다.'],
		[402, 'OpenRouter 크레딧이 부족합니다.'],
		[403, 'OpenRouter 요청 권한 또는 사용 한도를 확인해 주세요.'],
		[422, '설정한 AI 모델이나 요청 형식을 확인해 주세요.'],
		[502, 'AI 제공자가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.'],
		[529, 'AI 제공자가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.']
	])('maps OpenRouter status %i to an actionable message', (statusCode, message) => {
		expect(getOpenRouterUserMessage({ statusCode })).toBe(message);
	});

	it('distinguishes invalid JSON from connection failures', () => {
		expect(getOpenRouterUserMessage(new Error('OPENROUTER_API_KEY is required.'))).toBe(
			'OpenRouter API 키가 설정되지 않았습니다.'
		);
		expect(getOpenRouterUserMessage(new SyntaxError('invalid JSON'))).toBe(
			'AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.'
		);
		expect(getOpenRouterUserMessage(new Error('socket closed'))).toBe(
			'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
		);
	});
});
