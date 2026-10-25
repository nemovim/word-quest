import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQuizCard, makeQuizExample, makeUser, makeVoca } from '../helpers/factories';

import * as QuizCardRepository from '$lib/repositories/quiz-card.repository';
import * as QuizReportRepository from '$lib/repositories/quiz-report.repository';
import * as UserRepository from '$lib/repositories/user.repository';
import * as VocaRepository from '$lib/repositories/voca.repository';
import * as QuizReportAiService from '$lib/service/quiz-report-ai.service';
import {
	QUIZ_REPORT_ISSUES,
	QUIZ_REPORT_RECOMMENDATIONS,
	QUIZ_REPORT_RESOLUTION_ACTIONS,
	type QuizReportEntity,
	type QuizReportProposalAttempt
} from '$lib/shared/types/quiz-report.type';
import {
	acceptLatestQuizReportProposal,
	applyQuizReportAdminDraft,
	dismissQuizReport,
	generateQuizReportProposal,
	loadQuizReportItems,
	submitQuizReport
} from '$lib/usecases/quiz-report.usecase';

const voca = makeVoca();
const vocaSnapshot = QuizReportAiService.buildQuizReportVocaSnapshot(voca);
const example = makeQuizExample();
const reportData = {
	userId: 'user-1',
	vocaId: 'voca-1',
	quizExampleId: 'example-1',
	promptLang: 'ko' as const,
	answerLang: 'en' as const,
	issues: [QUIZ_REPORT_ISSUES.EXAMPLE, QUIZ_REPORT_ISSUES.PRONUNCIATION]
};

function makeProposal(
	overrides: Partial<QuizReportProposalAttempt> = {}
): QuizReportProposalAttempt {
	return {
		_id: 'attempt-1',
		createdAt: '2026-09-08T00:01:00.000Z',
		baseFingerprint: QuizReportAiService.buildQuizReportBaseFingerprint(vocaSnapshot, example),
		recommendation: QUIZ_REPORT_RECOMMENDATIONS.REPAIR,
		grounds: [],
		explanation: '예문을 수정해야 합니다.',
		repairable: true,
		suggestedRepair: '자연스러운 예문으로 바꿉니다.',
		proposedVoca: vocaSnapshot,
		proposedExample: makeQuizExample({ targetSentenceTemplate: 'I ate an {{---}}.' }),
		...overrides
	};
}

function makeReport(overrides: Partial<QuizReportEntity> = {}): QuizReportEntity {
	return {
		...reportData,
		_id: 'report-1',
		vocaSnapshot,
		quizExampleSnapshot: example,
		proposalAttempts: [],
		createdAt: '2026-09-08T00:00:00.000Z',
		updatedAt: '2026-09-08T00:00:00.000Z',
		...overrides
	};
}

describe('quiz-report.usecase', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(VocaRepository, 'getVocaById').mockResolvedValue(voca);
		vi.spyOn(QuizCardRepository, 'findQuizCardByVocaId').mockResolvedValue(makeQuizCard());
		vi.spyOn(QuizReportRepository, 'createQuizReport').mockResolvedValue(makeReport());
		vi.spyOn(QuizReportRepository, 'findQuizReportById').mockResolvedValue(makeReport());
		vi.spyOn(QuizReportRepository, 'resolveQuizReport').mockResolvedValue();
	});

	it('stores one multi-issue report with exact voca and example snapshots', async () => {
		await submitQuizReport({ ...reportData, details: '둘 다 어색합니다.' });

		expect(QuizReportRepository.createQuizReport).toHaveBeenCalledWith({
			...reportData,
			details: '둘 다 어색합니다.',
			vocaSnapshot,
			quizExampleSnapshot: example
		});
	});

	it('generates and appends an AI proposal without changing production data', async () => {
		const proposal = makeProposal();
		vi.spyOn(QuizReportAiService, 'createQuizReportProposal').mockResolvedValue(proposal);
		const appendSpy = vi
			.spyOn(QuizReportRepository, 'appendQuizReportProposal')
			.mockResolvedValue(makeReport({ proposalAttempts: [proposal] }));
		const applySpy = vi.spyOn(QuizReportRepository, 'applyQuizReportProposal');

		await generateQuizReportProposal('report-1');

		expect(QuizReportAiService.createQuizReportProposal).toHaveBeenCalledWith(
			expect.objectContaining({
				issues: reportData.issues,
				reportedVoca: vocaSnapshot,
				reportedExample: example,
				currentVoca: vocaSnapshot,
				currentExample: example
			})
		);
		expect(appendSpy).toHaveBeenCalledWith('report-1', proposal);
		expect(applySpy).not.toHaveBeenCalled();
	});

	it('applies only the latest non-stale proposal with an audit resolution', async () => {
		const proposal = makeProposal();
		vi.mocked(QuizReportRepository.findQuizReportById).mockResolvedValue(
			makeReport({ proposalAttempts: [proposal] })
		);
		const applySpy = vi.spyOn(QuizReportRepository, 'applyQuizReportProposal').mockResolvedValue();

		await applyQuizReportAdminDraft('report-1', 'admin-1', {
			proposalAttemptId: proposal._id,
			sections: ['voca', 'example', 'difficulty', 'utility'],
			proposedVoca: proposal.proposedVoca,
			proposedExample: proposal.proposedExample
		});

		expect(applySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				reportId: 'report-1',
				draft: expect.objectContaining({
					proposalAttemptId: 'attempt-1',
					sections: ['voca', 'example', 'difficulty', 'utility']
				}),
				expectedVoca: vocaSnapshot,
				expectedExample: example,
				resolution: expect.objectContaining({
					action: QUIZ_REPORT_RESOLUTION_ACTIONS.PROPOSAL_APPLIED,
					adminUserId: 'admin-1',
					proposalAttemptId: 'attempt-1',
					appliedSections: ['voca', 'example', 'difficulty', 'utility']
				})
			})
		);
	});

	it('accepts the AI recommendation with only its changed sections', async () => {
		const proposal = makeProposal({
			proposedVoca: { ...vocaSnapshot, difficultyLevel: 7 }
		});
		vi.mocked(QuizReportRepository.findQuizReportById).mockResolvedValue(
			makeReport({ proposalAttempts: [proposal] })
		);
		const applySpy = vi.spyOn(QuizReportRepository, 'applyQuizReportProposal').mockResolvedValue();

		await acceptLatestQuizReportProposal('report-1', 'admin-1');

		expect(applySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				draft: expect.objectContaining({ sections: ['difficulty', 'example'] }),
				resolution: expect.objectContaining({ appliedSections: ['difficulty', 'example'] })
			})
		);
	});

	it('applies only the administrator-selected difficulty value', async () => {
		const proposal = makeProposal({
			proposedVoca: { ...vocaSnapshot, difficultyLevel: 7, utilityScore: 1 }
		});
		vi.mocked(QuizReportRepository.findQuizReportById).mockResolvedValue(
			makeReport({ proposalAttempts: [proposal] })
		);
		const applySpy = vi.spyOn(QuizReportRepository, 'applyQuizReportProposal').mockResolvedValue();

		await applyQuizReportAdminDraft('report-1', 'admin-1', {
			proposalAttemptId: proposal._id,
			sections: ['difficulty'],
			proposedVoca: proposal.proposedVoca,
			proposedExample: proposal.proposedExample
		});

		expect(applySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				draft: expect.objectContaining({
					sections: ['difficulty'],
					proposedVoca: expect.objectContaining({
						difficultyLevel: 7,
						utilityScore: vocaSnapshot.utilityScore
					})
				}),
				resolution: expect.objectContaining({ appliedSections: ['difficulty'] })
			})
		);
	});

	it('rejects stale proposals before starting the apply transaction', async () => {
		const proposal = makeProposal();
		vi.mocked(QuizReportRepository.findQuizReportById).mockResolvedValue(
			makeReport({ proposalAttempts: [proposal] })
		);
		vi.mocked(QuizCardRepository.findQuizCardByVocaId).mockResolvedValue(
			makeQuizCard({ examples: [makeQuizExample({ targetFillText: 'changed' })] })
		);
		const applySpy = vi.spyOn(QuizReportRepository, 'applyQuizReportProposal');

		await expect(
			applyQuizReportAdminDraft('report-1', 'admin-1', {
				proposalAttemptId: proposal._id,
				sections: ['example'],
				proposedVoca: proposal.proposedVoca,
				proposedExample: proposal.proposedExample
			})
		).rejects.toThrow('제안을 다시 생성해 주세요');
		expect(applySpy).not.toHaveBeenCalled();
	});

	it('requires a note when an admin contradicts the AI recommendation', async () => {
		const proposal = makeProposal({ recommendation: QUIZ_REPORT_RECOMMENDATIONS.EXCLUDE });
		vi.mocked(QuizReportRepository.findQuizReportById).mockResolvedValue(
			makeReport({ proposalAttempts: [proposal] })
		);

		await expect(dismissQuizReport('report-1', 'admin-1')).rejects.toThrow('관리자 메모');
		await expect(
			dismissQuizReport('report-1', 'admin-1', '문맥상 유지합니다.')
		).resolves.toBeUndefined();
	});

	it('loads only pending reports and keeps current state separate from snapshots', async () => {
		vi.spyOn(QuizReportRepository, 'findPendingQuizReports').mockResolvedValue([makeReport()]);
		vi.spyOn(VocaRepository, 'findVocaByIds').mockResolvedValue([voca]);
		vi.spyOn(QuizCardRepository, 'findQuizCardsByVocaIds').mockResolvedValue([makeQuizCard()]);
		vi.spyOn(UserRepository, 'findUsersByIds').mockResolvedValue([makeUser()]);

		await expect(loadQuizReportItems()).resolves.toMatchObject([
			{
				report: { _id: 'report-1' },
				currentExample: example,
				reporter: { email: 'user@example.com' }
			}
		]);
	});
});
