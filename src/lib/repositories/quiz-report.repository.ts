import mongoose from 'mongoose';

import type { QuizExample } from '$lib/shared/types/quiz-card.type';
import type {
	QuizReportEntity,
	QuizReportAdminDraft,
	QuizReportProposalAttempt,
	QuizReportRecordCreate,
	QuizReportResolution,
	QuizReportVocaSnapshot
} from '$lib/shared/types/quiz-report.type';

import QuizCardModel from '$lib/models/quiz-card.model';
import QuizReportModel from '$lib/models/quiz-report.model';
import ReviewModel from '$lib/models/review.model';
import VocaModel from '$lib/models/voca.model';
import { QUIZ_REPORT_APPLY_SECTIONS } from '$lib/shared/types/quiz-report.type';
import { normalizeAnswer } from '$lib/shared/utils/answer.util';
import { toPojo } from '$lib/shared/utils/general.util';

const UNRESOLVED = {
	resolution: { $exists: false },
	'issues.0': { $exists: true },
	vocaSnapshot: { $exists: true },
	quizExampleSnapshot: { $exists: true }
} as const;

export async function createQuizReport(
	reportData: QuizReportRecordCreate
): Promise<QuizReportEntity> {
	const document = await QuizReportModel.create(reportData);
	return toPojo(document.toObject());
}

export async function findPendingReportedVocaIds(): Promise<string[]> {
	return QuizReportModel.distinct('vocaId', UNRESOLVED);
}

export async function findPendingQuizReports(limit: number): Promise<QuizReportEntity[]> {
	const documents = await QuizReportModel.find(UNRESOLVED)
		.sort({ createdAt: 1 })
		.limit(limit)
		.lean();
	return documents.map(toPojo<QuizReportEntity>);
}

export async function findQuizReportById(reportId: string): Promise<QuizReportEntity | null> {
	const document = await QuizReportModel.findById(reportId).lean();
	return document == null ? null : toPojo<QuizReportEntity>(document);
}

export async function appendQuizReportProposal(
	reportId: string,
	proposal: QuizReportProposalAttempt
): Promise<QuizReportEntity> {
	const document = await QuizReportModel.findOneAndUpdate(
		{ _id: reportId, ...UNRESOLVED },
		{ $push: { proposalAttempts: proposal } },
		{ returnDocument: 'after' }
	).lean();

	if (document == null) throw new Error('처리 대기 중인 신고를 찾을 수 없습니다.');
	return toPojo(document);
}

export async function resolveQuizReport(
	reportId: string,
	resolution: QuizReportResolution
): Promise<void> {
	const result = await QuizReportModel.updateOne(
		{ _id: reportId, ...UNRESOLVED },
		{ $set: { resolution } }
	);
	if (result.modifiedCount !== 1) throw new Error('처리 대기 중인 신고를 찾을 수 없습니다.');
}

function matchesVocaSnapshot(voca: Record<string, unknown>, expected: QuizReportVocaSnapshot) {
	return (Object.keys(expected) as Array<keyof QuizReportVocaSnapshot>).every(
		(field) => voca[field] === expected[field]
	);
}

function matchesExample(current: QuizExample, expected: QuizExample): boolean {
	return (Object.keys(expected) as Array<keyof QuizExample>).every(
		(field) => current[field] === expected[field]
	);
}

export async function applyQuizReportProposal(input: {
	reportId: string;
	draft: QuizReportAdminDraft;
	expectedVoca: QuizReportVocaSnapshot;
	expectedExample: QuizExample;
	resolution: QuizReportResolution;
}): Promise<void> {
	await mongoose.connection.transaction(async (session) => {
		const report = await QuizReportModel.findOne({ _id: input.reportId, ...UNRESOLVED })
			.session(session)
			.lean();
		const proposal = report?.proposalAttempts.at(-1);
		if (report == null || proposal?._id !== input.draft.proposalAttemptId) {
			throw new Error('적용할 최신 AI 제안을 찾을 수 없습니다.');
		}

		const [voca, quizCard] = await Promise.all([
			VocaModel.findById(report.vocaId).session(session).lean(),
			QuizCardModel.findOne({ vocaId: report.vocaId }).session(session).lean()
		]);
		const example = quizCard?.examples.find(
			(current: QuizExample) => current._id === report.quizExampleId
		) as QuizExample | undefined;
		if (
			voca == null ||
			quizCard == null ||
			example == null ||
			!matchesVocaSnapshot(voca, input.expectedVoca) ||
			!matchesExample(toPojo<QuizExample>(example), input.expectedExample)
		) {
			throw new Error('AI 제안 이후 단어나 예문이 변경되었습니다. 제안을 다시 생성해 주세요.');
		}

		const sections = new Set(input.draft.sections);
		const proposedVoca = {
			...input.expectedVoca,
			...(sections.has(QUIZ_REPORT_APPLY_SECTIONS.VOCA)
				? {
						sourceText: input.draft.proposedVoca.sourceText,
						sourceDefinition: input.draft.proposedVoca.sourceDefinition,
						partOfSpeech: input.draft.proposedVoca.partOfSpeech,
						targetText: input.draft.proposedVoca.targetText,
						targetDefinition: input.draft.proposedVoca.targetDefinition
					}
				: {}),
			...(sections.has(QUIZ_REPORT_APPLY_SECTIONS.DIFFICULTY)
				? { difficultyLevel: input.draft.proposedVoca.difficultyLevel }
				: {}),
			...(sections.has(QUIZ_REPORT_APPLY_SECTIONS.UTILITY)
				? { utilityScore: input.draft.proposedVoca.utilityScore }
				: {})
		};
		const proposedExample = sections.has(QUIZ_REPORT_APPLY_SECTIONS.EXAMPLE)
			? input.draft.proposedExample
			: input.expectedExample;
		const vocaChanged = !matchesVocaSnapshot(proposedVoca, input.expectedVoca);
		const exampleChanged = !matchesExample(proposedExample, input.expectedExample);
		const contentVocaChanged = (
			['sourceText', 'sourceDefinition', 'partOfSpeech', 'targetText', 'targetDefinition'] as const
		).some((field) => proposedVoca[field] !== input.expectedVoca[field]);
		const pairChanged =
			proposedVoca.sourceText !== input.expectedVoca.sourceText ||
			proposedVoca.targetText !== input.expectedVoca.targetText ||
			proposedVoca.partOfSpeech !== input.expectedVoca.partOfSpeech;
		if (vocaChanged) {
			const scoreChanged =
				proposedVoca.difficultyLevel !== input.expectedVoca.difficultyLevel ||
				proposedVoca.utilityScore !== input.expectedVoca.utilityScore;
			await VocaModel.updateOne(
				{ _id: report.vocaId },
				{
					$set: {
						...proposedVoca,
						normalizedTargetText: normalizeAnswer(proposedVoca.targetText, proposedVoca.targetLang),
						...(scoreChanged ? { scoreReviewCount: 0, scoreEvaluatedAt: null } : {})
					}
				},
				{ session, runValidators: true }
			);
		}
		if (pairChanged || exampleChanged) {
			const examples = pairChanged
				? [proposedExample]
				: quizCard.examples.map((current: QuizExample) =>
						current._id === report.quizExampleId ? proposedExample : current
					);
			await QuizCardModel.updateOne(
				{ _id: quizCard._id },
				{ $set: { examples } },
				{ session, runValidators: true }
			);
		}
		if (contentVocaChanged || exampleChanged) {
			await ReviewModel.deleteMany({ vocaId: report.vocaId }, { session });
		}
		await QuizReportModel.updateOne(
			{ _id: report._id, ...UNRESOLVED },
			{ $set: { resolution: input.resolution } },
			{ session }
		);
	});
}

export async function deleteReportedExample(input: {
	reportId: string;
	resolution: QuizReportResolution;
}): Promise<void> {
	await mongoose.connection.transaction(async (session) => {
		const report = await QuizReportModel.findOne({ _id: input.reportId, ...UNRESOLVED })
			.session(session)
			.lean();
		if (report == null) throw new Error('처리 대기 중인 신고를 찾을 수 없습니다.');

		const result = await QuizCardModel.updateOne(
			{ vocaId: report.vocaId, 'examples._id': report.quizExampleId },
			{ $pull: { examples: { _id: report.quizExampleId } } },
			{ session }
		);
		if (result.modifiedCount !== 1) throw new Error('신고된 예문을 찾을 수 없습니다.');

		await ReviewModel.deleteMany({ vocaId: report.vocaId }, { session });
		await QuizReportModel.updateMany(
			{ vocaId: report.vocaId, quizExampleId: report.quizExampleId, ...UNRESOLVED },
			{ $set: { resolution: input.resolution } },
			{ session }
		);
	});
}

export async function excludeReportedVoca(input: {
	reportId: string;
	resolution: QuizReportResolution;
}): Promise<void> {
	await mongoose.connection.transaction(async (session) => {
		const report = await QuizReportModel.findOne({ _id: input.reportId, ...UNRESOLVED })
			.session(session)
			.lean();
		if (report == null) throw new Error('처리 대기 중인 신고를 찾을 수 없습니다.');

		await VocaModel.updateOne(
			{ _id: report.vocaId },
			{ $set: { quizExcludedByReportId: report._id } },
			{ session }
		);
		await ReviewModel.deleteMany({ vocaId: report.vocaId }, { session });
		await QuizReportModel.updateMany(
			{ vocaId: report.vocaId, ...UNRESOLVED },
			{ $set: { resolution: input.resolution } },
			{ session }
		);
	});
}
