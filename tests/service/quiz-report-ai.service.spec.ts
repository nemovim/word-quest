import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendOpenRouterJsonMock } = vi.hoisted(() => ({ sendOpenRouterJsonMock: vi.fn() }));

vi.mock('$lib/server/openrouter', () => ({ sendOpenRouterJson: sendOpenRouterJsonMock }));

import { makeQuizExample, makeVoca } from '../helpers/factories';

import {
	buildQuizReportRepairPlan,
	buildQuizReportVocaSnapshot,
	createQuizReportProposal
} from '$lib/service/quiz-report-ai.service';
import {
	QUIZ_REPORT_ISSUES,
	QUIZ_REPORT_RECOMMENDATIONS
} from '$lib/shared/types/quiz-report.type';

const voca = buildQuizReportVocaSnapshot(makeVoca());
const example = makeQuizExample({ targetPronunciationText: '애플' });

function aiProposal(pronunciationText = '애플') {
	return {
		recommendation: QUIZ_REPORT_RECOMMENDATIONS.REPAIR,
		grounds: [],
		explanation: '발음을 바로잡습니다.',
		repairable: true,
		suggestedRepair: '발음만 수정합니다.',
		proposedVoca: voca,
		proposedExample: {
			texts: [
				{
					languageCode: 'ko',
					fullSentence: 'I ate source-word on the source side.',
					answerSurface: 'source-word',
					pronunciationText: '소스워드'
				},
				{
					languageCode: 'en',
					fullSentence: 'I ate apple.',
					answerSurface: 'apple',
					pronunciationText
				}
			]
		}
	};
}

describe('quiz-report-ai.service', () => {
	beforeEach(() => vi.clearAllMocks());

	it('merges issue routes without duplicate mutable fields', () => {
		expect(
			buildQuizReportRepairPlan([
				QUIZ_REPORT_ISSUES.TRANSLATION,
				QUIZ_REPORT_ISSUES.PRONUNCIATION,
				QUIZ_REPORT_ISSUES.DIFFICULTY_TOO_HIGH
			])
		).toMatchObject({
			vocaFields: ['difficultyLevel'],
			exampleFields: ['targetSentenceTemplate', 'targetFillText', 'targetPronunciationText']
		});
	});

	it('sends issue-specific mutable fields and accepts only the pronunciation change', async () => {
		sendOpenRouterJsonMock.mockResolvedValue(aiProposal('애플르'));

		const result = await createQuizReportProposal({
			issues: [QUIZ_REPORT_ISSUES.PRONUNCIATION],
			details: '실제 발음과 다릅니다.',
			reportedVoca: voca,
			reportedExample: example,
			currentVoca: voca,
			currentExample: example
		});
		const [request] = sendOpenRouterJsonMock.mock.calls[0] ?? [];
		const schemaText = JSON.stringify(request.schema);

		expect(request.messages[0].content).toContain('Editable voca fields: none');
		expect(request.messages[0].content).toContain(
			'Editable example fields: targetPronunciationText'
		);
		expect(request.messages[1].content).toContain('실제 발음과 다릅니다.');
		expect(schemaText).not.toContain('uniqueItems');
		expect(schemaText).not.toContain('"type":[');
		expect(schemaText).toContain('"anyOf"');
		expect(result.proposedExample).toEqual({ ...example, targetPronunciationText: '애플르' });
	});

	it('keeps a schema-valid AI draft visible for administrator customization', async () => {
		const invalid = aiProposal('애플르');
		invalid.proposedVoca = { ...voca, utilityScore: 1 };
		sendOpenRouterJsonMock.mockResolvedValue(invalid);

		await expect(
			createQuizReportProposal({
				issues: [QUIZ_REPORT_ISSUES.PRONUNCIATION],
				reportedVoca: voca,
				reportedExample: example,
				currentVoca: voca,
				currentExample: example
			})
		).resolves.toMatchObject({ proposedVoca: { utilityScore: 1 } });
		expect(sendOpenRouterJsonMock).toHaveBeenCalledOnce();
	});

	it('keeps a difficulty assessment visible even when AI proposes no score change', async () => {
		sendOpenRouterJsonMock.mockResolvedValue(aiProposal());

		await expect(
			createQuizReportProposal({
				issues: [QUIZ_REPORT_ISSUES.DIFFICULTY_TOO_HIGH],
				reportedVoca: voca,
				reportedExample: example,
				currentVoca: voca,
				currentExample: example
			})
		).resolves.toMatchObject({
			explanation: '발음을 바로잡습니다.',
			proposedVoca: voca
		});
		expect(sendOpenRouterJsonMock).toHaveBeenCalledOnce();
	});

	it('allows a suitability assessment to recommend repair without mutating production fields', async () => {
		sendOpenRouterJsonMock.mockResolvedValue(aiProposal());

		await expect(
			createQuizReportProposal({
				issues: [QUIZ_REPORT_ISSUES.NOT_SUITABLE_FOR_QUIZ],
				reportedVoca: voca,
				reportedExample: example,
				currentVoca: voca,
				currentExample: example
			})
		).resolves.toMatchObject({
			recommendation: QUIZ_REPORT_RECOMMENDATIONS.REPAIR,
			proposedVoca: voca,
			proposedExample: example
		});
	});
});
