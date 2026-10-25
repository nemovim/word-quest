import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendOpenRouterJsonMock } = vi.hoisted(() => ({
	sendOpenRouterJsonMock: vi.fn()
}));

vi.mock('$lib/server/openrouter', () => ({
	sendOpenRouterJson: sendOpenRouterJsonMock
}));

import { makeQuizEncounter } from '../helpers/factories';

import { judgeAnswer } from '$lib/service/ai-judge.service';
import { AI_JUDGE_REASON_CODES, QUIZ_TEMPLATE_SLOT } from '$lib/shared/types/general.type';
import { AI_JUDGE_REASON_FALLBACK_HINTS } from '$lib/shared/utils/quiz-feedback.util';

function makeEncounter() {
	return makeQuizEncounter({
		promptTemplate: `\ub098\ub294 ${QUIZ_TEMPLATE_SLOT} \uba39\uc5c8\ub2e4.`,
		promptFillText: '\uc0ac\uacfc',
		answerTemplate: `I ate ${QUIZ_TEMPLATE_SLOT}.`,
		pronunciationText: '\uc560\ud50c'
	});
}

describe('ai-judge.service judge prompt', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sendOpenRouterJsonMock.mockResolvedValue({
			reasonCode: AI_JUDGE_REASON_CODES.TYPO,
			hintText: '\ucca0\uc790\uac00 \uc870\uae08 \ub2ec\ub77c\uc694.'
		});
	});

	it('requests explanation only for non-exact answers', async () => {
		await judgeAnswer(makeEncounter(), 'apple', 'appl');

		const [request] = sendOpenRouterJsonMock.mock.calls[0] ?? [];
		const developerPrompt = request?.messages[0]?.content ?? '';
		const userPrompt = request?.messages[1]?.content ?? '';

		expect(request?.schema?.required).toEqual(['reasonCode', 'hintText']);
		expect(request?.schema?.properties?.reasonCode).toEqual({
			type: 'string',
			enum: Object.values(AI_JUDGE_REASON_CODES)
		});
		expect(request?.schema?.properties?.hintText).toEqual({ type: 'string' });
		expect(developerPrompt).toContain('hintText must be short Korean.');
		expect(userPrompt).toContain('answerLang:en');
		expect(userPrompt).toContain('correct:apple');
		expect(userPrompt).toContain('answerSentence:I ate apple.');
		expect(userPrompt).toContain('promptSentence:\ub098\ub294 \uc0ac\uacfc \uba39\uc5c8\ub2e4.');
		expect(userPrompt).toContain('userAnswer:appl');
	});

	it('replaces leaked exact answers in hintText with a fallback hint', async () => {
		sendOpenRouterJsonMock.mockResolvedValueOnce({
			reasonCode: AI_JUDGE_REASON_CODES.ALTERNATE_ANSWER,
			hintText: "\uc815\ud655\ud55c \ub2e8\uc5b4\ub294 'apple'\uc774\uc5d0\uc694."
		});

		const result = await judgeAnswer(makeEncounter(), 'apple', 'apples');

		expect(result.reasonCode).toBe(AI_JUDGE_REASON_CODES.ALTERNATE_ANSWER);
		expect(result.hintText).toBe(
			AI_JUDGE_REASON_FALLBACK_HINTS[AI_JUDGE_REASON_CODES.ALTERNATE_ANSWER]
		);
		expect(result.hintText).not.toContain('apple');
	});
});
