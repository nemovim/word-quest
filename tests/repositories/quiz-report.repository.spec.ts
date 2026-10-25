import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	createMock,
	distinctMock,
	findMock,
	findOneMock,
	findOneAndUpdateMock,
	updateOneMock,
	updateManyMock,
	transactionMock,
	reviewDeleteManyMock,
	vocaFindByIdMock,
	vocaUpdateOneMock,
	quizCardFindOneMock,
	quizCardUpdateOneMock
} = vi.hoisted(() => ({
	createMock: vi.fn(),
	distinctMock: vi.fn(),
	findMock: vi.fn(),
	findOneMock: vi.fn(),
	findOneAndUpdateMock: vi.fn(),
	updateOneMock: vi.fn(),
	updateManyMock: vi.fn(),
	transactionMock: vi.fn(),
	reviewDeleteManyMock: vi.fn(),
	vocaFindByIdMock: vi.fn(),
	vocaUpdateOneMock: vi.fn(),
	quizCardFindOneMock: vi.fn(),
	quizCardUpdateOneMock: vi.fn()
}));

vi.mock('mongoose', () => ({
	default: { connection: { transaction: transactionMock } }
}));

vi.mock('$lib/models/quiz-report.model', () => ({
	default: {
		create: createMock,
		distinct: distinctMock,
		find: findMock,
		findOne: findOneMock,
		findOneAndUpdate: findOneAndUpdateMock,
		updateOne: updateOneMock,
		updateMany: updateManyMock
	}
}));

vi.mock('$lib/models/review.model', () => ({
	default: { deleteMany: reviewDeleteManyMock }
}));

vi.mock('$lib/models/voca.model', () => ({
	default: { findById: vocaFindByIdMock, updateOne: vocaUpdateOneMock }
}));

vi.mock('$lib/models/quiz-card.model', () => ({
	default: { findOne: quizCardFindOneMock, updateOne: quizCardUpdateOneMock }
}));

import { makeQuizExample, makeVoca } from '../helpers/factories';

import {
	applyQuizReportProposal,
	appendQuizReportProposal,
	createQuizReport,
	findPendingQuizReports,
	findPendingReportedVocaIds,
	resolveQuizReport
} from '$lib/repositories/quiz-report.repository';
import { buildQuizReportVocaSnapshot } from '$lib/service/quiz-report-ai.service';
import {
	QUIZ_REPORT_APPLY_SECTIONS,
	QUIZ_REPORT_ISSUES,
	QUIZ_REPORT_RESOLUTION_ACTIONS
} from '$lib/shared/types/quiz-report.type';

const reportData = {
	userId: 'user-1',
	vocaId: 'voca-1',
	quizExampleId: 'example-1',
	promptLang: 'ko' as const,
	answerLang: 'en' as const,
	issues: [QUIZ_REPORT_ISSUES.TRANSLATION],
	details: '더 자연스러운 표현이 필요합니다.',
	vocaSnapshot: buildQuizReportVocaSnapshot(makeVoca()),
	quizExampleSnapshot: makeQuizExample()
};
const unresolved = {
	resolution: { $exists: false },
	'issues.0': { $exists: true },
	vocaSnapshot: { $exists: true },
	quizExampleSnapshot: { $exists: true }
};

describe('quiz-report.repository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		transactionMock.mockImplementation(async (callback) => callback('session'));
	});

	it('creates every submission as its own report', async () => {
		const stored = { _id: 'report-1', ...reportData, proposalAttempts: [] };
		createMock.mockResolvedValue({ toObject: () => stored });

		await expect(createQuizReport(reportData)).resolves.toMatchObject(stored);
		expect(createMock).toHaveBeenCalledWith(reportData);
	});

	it('preserves review schedules when applying only a difficulty change', async () => {
		const voca = makeVoca({ difficultyLevel: 3, utilityScore: 4 });
		const vocaSnapshot = buildQuizReportVocaSnapshot(voca);
		const quizExample = makeQuizExample();
		const quizCard = { _id: 'card-1', vocaId: voca._id, examples: [quizExample] };
		const report = {
			_id: 'report-1',
			vocaId: voca._id,
			quizExampleId: quizExample._id,
			proposalAttempts: [{ _id: 'attempt-1' }]
		};
		const query = (value: unknown) => ({
			session: vi.fn(() => ({ lean: vi.fn().mockResolvedValue(value) }))
		});
		findOneMock.mockReturnValue(query(report));
		vocaFindByIdMock.mockReturnValue(query(voca));
		quizCardFindOneMock.mockReturnValue(query(quizCard));
		vocaUpdateOneMock.mockResolvedValue({ modifiedCount: 1 });
		updateOneMock.mockResolvedValue({ modifiedCount: 1 });

		await applyQuizReportProposal({
			reportId: 'report-1',
			draft: {
				proposalAttemptId: 'attempt-1',
				sections: [QUIZ_REPORT_APPLY_SECTIONS.DIFFICULTY],
				proposedVoca: { ...vocaSnapshot, difficultyLevel: 7 },
				proposedExample: quizExample
			},
			expectedVoca: vocaSnapshot,
			expectedExample: quizExample,
			resolution: {
				action: QUIZ_REPORT_RESOLUTION_ACTIONS.PROPOSAL_APPLIED,
				adminUserId: 'admin-1',
				resolvedAt: '2026-09-13T00:00:00.000Z',
				appliedSections: [QUIZ_REPORT_APPLY_SECTIONS.DIFFICULTY]
			}
		});

		expect(vocaUpdateOneMock).toHaveBeenCalledWith(
			{ _id: voca._id },
			expect.objectContaining({
				$set: expect.objectContaining({
					difficultyLevel: 7,
					utilityScore: 4,
					scoreReviewCount: 0,
					scoreEvaluatedAt: null
				})
			}),
			{ session: 'session', runValidators: true }
		);
		expect(quizCardUpdateOneMock).not.toHaveBeenCalled();
		expect(reviewDeleteManyMock).not.toHaveBeenCalled();
	});

	it('finds only unresolved reports and their word ids', async () => {
		distinctMock.mockResolvedValue(['voca-1']);
		const lean = vi.fn().mockResolvedValue([{ _id: 'report-1' }]);
		const limit = vi.fn(() => ({ lean }));
		const sort = vi.fn(() => ({ limit }));
		findMock.mockReturnValue({ sort });

		await expect(findPendingReportedVocaIds()).resolves.toEqual(['voca-1']);
		await expect(findPendingQuizReports(10)).resolves.toEqual([{ _id: 'report-1' }]);
		expect(distinctMock).toHaveBeenCalledWith('vocaId', {
			...unresolved
		});
		expect(findMock).toHaveBeenCalledWith(unresolved);
	});

	it('appends proposals and records resolutions only while unresolved', async () => {
		const proposal = { _id: 'attempt-1' } as never;
		findOneAndUpdateMock.mockReturnValue({
			lean: async () => ({ _id: 'report-1', proposalAttempts: [proposal] })
		});
		updateOneMock.mockResolvedValue({ modifiedCount: 1 });

		await appendQuizReportProposal('report-1', proposal);
		await resolveQuizReport('report-1', {
			action: QUIZ_REPORT_RESOLUTION_ACTIONS.DISMISSED,
			adminUserId: 'admin-1',
			resolvedAt: '2026-09-08T00:00:00.000Z'
		});

		expect(findOneAndUpdateMock).toHaveBeenCalledWith(
			{ _id: 'report-1', ...unresolved },
			{ $push: { proposalAttempts: proposal } },
			{ returnDocument: 'after' }
		);
		expect(updateOneMock).toHaveBeenCalledWith(
			{ _id: 'report-1', ...unresolved },
			{
				$set: {
					resolution: {
						action: QUIZ_REPORT_RESOLUTION_ACTIONS.DISMISSED,
						adminUserId: 'admin-1',
						resolvedAt: '2026-09-08T00:00:00.000Z'
					}
				}
			}
		);
	});
});
