import type { QuizExample } from '$lib/shared/types/quiz-card.type';
import type {
	QuizReportAdminDraft,
	QuizReportApplySection,
	QuizReportCreate,
	QuizReportEntity,
	QuizReportProposalAttempt,
	QuizReportRecommendation,
	QuizReportResolution,
	QuizReportResolutionAction,
	QuizReportVocaSnapshot
} from '$lib/shared/types/quiz-report.type';
import type { UserEntity } from '$lib/shared/types/user.type';
import type { VocaEntity } from '$lib/shared/types/voca.type';

import {
	findQuizCardByVocaId,
	findQuizCardsByVocaIds
} from '$lib/repositories/quiz-card.repository';
import {
	appendQuizReportProposal,
	applyQuizReportProposal,
	createQuizReport,
	deleteReportedExample,
	excludeReportedVoca,
	findPendingQuizReports,
	findQuizReportById,
	resolveQuizReport
} from '$lib/repositories/quiz-report.repository';
import { findUsersByIds } from '$lib/repositories/user.repository';
import { findVocaByIds, getVocaById } from '$lib/repositories/voca.repository';
import {
	buildQuizReportBaseFingerprint,
	buildQuizReportVocaSnapshot,
	createQuizReportProposal as createAiProposal,
	normalizeQuizReportExampleDraft
} from '$lib/service/quiz-report-ai.service';
import {
	QUIZ_REPORT_APPLY_SECTIONS,
	QUIZ_REPORT_ISSUES,
	QUIZ_REPORT_RECOMMENDATIONS,
	QUIZ_REPORT_RESOLUTION_ACTIONS
} from '$lib/shared/types/quiz-report.type';
import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';

export type QuizReportItem = {
	report: QuizReportEntity;
	voca: VocaEntity | null;
	currentExample: QuizExample | null;
	reporter: Pick<UserEntity, '_id' | 'email' | 'name'> | null;
};

function normalizeAdminText(value?: string): string | undefined {
	const normalized = value?.trim();
	if (normalized != null && normalized.length > 500) {
		throw new Error('관리자 메모는 500자 이하여야 합니다.');
	}
	return normalized === '' ? undefined : normalized;
}

function getLatestProposal(report: QuizReportEntity) {
	return report.proposalAttempts.at(-1);
}

function requirePendingReport(report: QuizReportEntity | null): QuizReportEntity {
	if (report == null || report.resolution != null) {
		throw new Error('처리 대기 중인 신고를 찾을 수 없습니다.');
	}
	return report;
}

function requireDecisionNote(
	report: QuizReportEntity,
	expectedRecommendation: QuizReportRecommendation,
	note?: string
): string | undefined {
	const normalizedNote = normalizeAdminText(note);
	const recommendation = getLatestProposal(report)?.recommendation;
	if (
		recommendation != null &&
		recommendation !== expectedRecommendation &&
		normalizedNote == null
	) {
		throw new Error('AI 권고와 다른 결정을 내릴 때는 관리자 메모가 필요합니다.');
	}
	return normalizedNote;
}

function buildResolution(
	action: QuizReportResolutionAction,
	adminUserId: string,
	note?: string,
	proposalAttemptId?: string,
	appliedSections?: QuizReportApplySection[]
): QuizReportResolution {
	return {
		action,
		adminUserId,
		resolvedAt: new Date().toISOString(),
		...(note == null ? {} : { note }),
		...(proposalAttemptId == null ? {} : { proposalAttemptId }),
		...(appliedSections == null ? {} : { appliedSections })
	};
}

const VOCA_DRAFT_FIELDS = [
	'sourceText',
	'sourceDefinition',
	'partOfSpeech',
	'targetText',
	'targetDefinition'
] as const;
const EXAMPLE_DRAFT_FIELDS = [
	'sourceSentenceTemplate',
	'sourceFillText',
	'targetSentenceTemplate',
	'targetFillText',
	'targetPronunciationText'
] as const;

function findChangedProposalSections(
	proposal: QuizReportProposalAttempt,
	currentVoca: QuizReportVocaSnapshot,
	currentExample: QuizExample
): QuizReportApplySection[] {
	const sections: QuizReportApplySection[] = [];
	if (VOCA_DRAFT_FIELDS.some((field) => proposal.proposedVoca[field] !== currentVoca[field])) {
		sections.push(QUIZ_REPORT_APPLY_SECTIONS.VOCA);
	}
	if (proposal.proposedVoca.difficultyLevel !== currentVoca.difficultyLevel) {
		sections.push(QUIZ_REPORT_APPLY_SECTIONS.DIFFICULTY);
	}
	if (proposal.proposedVoca.utilityScore !== currentVoca.utilityScore) {
		sections.push(QUIZ_REPORT_APPLY_SECTIONS.UTILITY);
	}
	if (
		EXAMPLE_DRAFT_FIELDS.some((field) => proposal.proposedExample[field] !== currentExample[field])
	) {
		sections.push(QUIZ_REPORT_APPLY_SECTIONS.EXAMPLE);
	}
	return sections;
}

function normalizeNullableScore(
	value: number | null,
	minimum: number,
	maximum: number,
	label: string
): number | null {
	if (value != null && (!Number.isInteger(value) || value < minimum || value > maximum)) {
		throw new Error(`${label} 값이 올바르지 않습니다.`);
	}
	return value;
}

function normalizeAdminDraft(
	draft: QuizReportAdminDraft,
	currentVoca: QuizReportVocaSnapshot,
	currentExample: QuizExample
): QuizReportAdminDraft {
	const sections = [...new Set(draft.sections)].filter((section) =>
		Object.values(QUIZ_REPORT_APPLY_SECTIONS).includes(section)
	);
	if (sections.length === 0) throw new Error('적용할 항목을 하나 이상 선택해 주세요.');
	const selected = new Set(sections);
	const textValue = (value: string, label: string) => {
		const normalized = value.trim();
		if (normalized === '') throw new Error(`${label} 값을 입력해 주세요.`);
		return normalized;
	};
	const proposedVoca = {
		...currentVoca,
		...(selected.has(QUIZ_REPORT_APPLY_SECTIONS.VOCA)
			? {
					sourceText: textValue(draft.proposedVoca.sourceText, '한국어'),
					sourceDefinition: textValue(draft.proposedVoca.sourceDefinition, '한국어 뜻'),
					partOfSpeech: draft.proposedVoca.partOfSpeech,
					targetText: textValue(draft.proposedVoca.targetText, '대상어'),
					targetDefinition: textValue(draft.proposedVoca.targetDefinition, '대상어 뜻')
				}
			: {}),
		...(selected.has(QUIZ_REPORT_APPLY_SECTIONS.DIFFICULTY)
			? {
					difficultyLevel: normalizeNullableScore(
						draft.proposedVoca.difficultyLevel,
						1,
						10,
						'난이도'
					)
				}
			: {}),
		...(selected.has(QUIZ_REPORT_APPLY_SECTIONS.UTILITY)
			? {
					utilityScore: normalizeNullableScore(draft.proposedVoca.utilityScore, 0, 5, '활용도')
				}
			: {})
	};
	if (!Object.values(PARTS_OF_SPEECH).includes(proposedVoca.partOfSpeech)) {
		throw new Error('품사 값이 올바르지 않습니다.');
	}
	const proposedExample = selected.has(QUIZ_REPORT_APPLY_SECTIONS.EXAMPLE)
		? normalizeQuizReportExampleDraft(draft.proposedExample, currentVoca.targetLang, currentExample)
		: currentExample;
	const hasVocaChange = VOCA_DRAFT_FIELDS.some(
		(field) => proposedVoca[field] !== currentVoca[field]
	);
	const pairChanged = (['sourceText', 'partOfSpeech', 'targetText'] as const).some(
		(field) => proposedVoca[field] !== currentVoca[field]
	);
	if (pairChanged && !selected.has(QUIZ_REPORT_APPLY_SECTIONS.EXAMPLE)) {
		throw new Error('단어나 품사를 바꿀 때는 새 예문도 함께 적용해야 합니다.');
	}
	const hasChange =
		hasVocaChange ||
		proposedVoca.difficultyLevel !== currentVoca.difficultyLevel ||
		proposedVoca.utilityScore !== currentVoca.utilityScore ||
		EXAMPLE_DRAFT_FIELDS.some((field) => proposedExample[field] !== currentExample[field]);
	if (!hasChange) throw new Error('선택한 항목에 변경된 값이 없습니다.');

	return { ...draft, sections, proposedVoca, proposedExample };
}

async function buildQuizReportItems(reports: QuizReportEntity[]): Promise<QuizReportItem[]> {
	const vocaIds = [...new Set(reports.map((report) => report.vocaId))];
	const userIds = [...new Set(reports.map((report) => report.userId))];
	const [vocas, quizCards, users] = await Promise.all([
		findVocaByIds(vocaIds),
		findQuizCardsByVocaIds(vocaIds),
		findUsersByIds(userIds)
	]);
	const vocaById = new Map(vocas.map((voca) => [voca._id, voca]));
	const quizCardByVocaId = new Map(quizCards.map((quizCard) => [quizCard.vocaId, quizCard]));
	const userById = new Map(users.map((user) => [user._id, user]));

	return reports.map((report) => ({
		report,
		voca: vocaById.get(report.vocaId) ?? null,
		currentExample:
			quizCardByVocaId
				.get(report.vocaId)
				?.examples.find((example) => example._id === report.quizExampleId) ?? null,
		reporter: userById.get(report.userId) ?? null
	}));
}

export async function loadQuizReportItems(limit = 200): Promise<QuizReportItem[]> {
	return buildQuizReportItems(await findPendingQuizReports(limit));
}

export async function generateQuizReportProposal(
	reportId: string,
	adminInstruction?: string
): Promise<void> {
	const report = requirePendingReport(await findQuizReportById(reportId));
	const instruction = normalizeAdminText(adminInstruction);
	if (
		report.issues.includes(QUIZ_REPORT_ISSUES.OTHER) &&
		report.details == null &&
		instruction == null
	) {
		throw new Error('기타 신고는 구체적인 신고 설명이나 관리자 지시가 필요합니다.');
	}

	const [voca, quizCard] = await Promise.all([
		getVocaById(report.vocaId),
		findQuizCardByVocaId(report.vocaId)
	]);
	const currentExample = quizCard?.examples.find((example) => example._id === report.quizExampleId);
	if (currentExample == null) throw new Error('신고된 현재 예문을 찾을 수 없습니다.');

	await appendQuizReportProposal(
		reportId,
		await createAiProposal({
			issues: report.issues,
			details: report.details,
			adminInstruction: instruction,
			reportedVoca: report.vocaSnapshot,
			reportedExample: report.quizExampleSnapshot,
			currentVoca: buildQuizReportVocaSnapshot(voca),
			currentExample
		})
	);
}

export async function applyQuizReportAdminDraft(
	reportId: string,
	adminUserId: string,
	draft: QuizReportAdminDraft,
	note?: string
): Promise<void> {
	const report = requirePendingReport(await findQuizReportById(reportId));
	const proposal = getLatestProposal(report);
	if (proposal == null || proposal._id !== draft.proposalAttemptId) {
		throw new Error('최신 AI 제안을 기준으로 다시 검토해 주세요.');
	}
	const normalizedNote = requireDecisionNote(report, QUIZ_REPORT_RECOMMENDATIONS.REPAIR, note);
	const [voca, quizCard] = await Promise.all([
		getVocaById(report.vocaId),
		findQuizCardByVocaId(report.vocaId)
	]);
	const currentExample = quizCard?.examples.find((example) => example._id === report.quizExampleId);
	if (currentExample == null) throw new Error('신고된 현재 예문을 찾을 수 없습니다.');
	const currentVoca = buildQuizReportVocaSnapshot(voca);
	if (buildQuizReportBaseFingerprint(currentVoca, currentExample) !== proposal.baseFingerprint) {
		throw new Error('AI 제안 이후 단어나 예문이 변경되었습니다. 제안을 다시 생성해 주세요.');
	}
	const normalizedDraft = normalizeAdminDraft(draft, currentVoca, currentExample);

	await applyQuizReportProposal({
		reportId,
		draft: normalizedDraft,
		expectedVoca: currentVoca,
		expectedExample: currentExample,
		resolution: buildResolution(
			QUIZ_REPORT_RESOLUTION_ACTIONS.PROPOSAL_APPLIED,
			adminUserId,
			normalizedNote,
			proposal._id,
			normalizedDraft.sections
		)
	});
}

export async function acceptLatestQuizReportProposal(
	reportId: string,
	adminUserId: string
): Promise<void> {
	const report = requirePendingReport(await findQuizReportById(reportId));
	const proposal = getLatestProposal(report);
	if (proposal?.recommendation !== QUIZ_REPORT_RECOMMENDATIONS.REPAIR) {
		throw new Error('적용할 AI 수정 제안을 찾을 수 없습니다.');
	}
	const [voca, quizCard] = await Promise.all([
		getVocaById(report.vocaId),
		findQuizCardByVocaId(report.vocaId)
	]);
	const currentExample = quizCard?.examples.find((example) => example._id === report.quizExampleId);
	if (currentExample == null) throw new Error('신고된 현재 예문을 찾을 수 없습니다.');
	const currentVoca = buildQuizReportVocaSnapshot(voca);

	await applyQuizReportAdminDraft(reportId, adminUserId, {
		proposalAttemptId: proposal._id,
		sections: findChangedProposalSections(proposal, currentVoca, currentExample),
		proposedVoca: proposal.proposedVoca,
		proposedExample: proposal.proposedExample
	});
}

export async function dismissQuizReport(
	reportId: string,
	adminUserId: string,
	note?: string
): Promise<void> {
	const report = requirePendingReport(await findQuizReportById(reportId));
	await resolveQuizReport(
		reportId,
		buildResolution(
			QUIZ_REPORT_RESOLUTION_ACTIONS.DISMISSED,
			adminUserId,
			requireDecisionNote(report, QUIZ_REPORT_RECOMMENDATIONS.KEEP, note)
		)
	);
}

export async function deleteReportedQuizExample(
	reportId: string,
	adminUserId: string,
	note?: string
): Promise<void> {
	const report = requirePendingReport(await findQuizReportById(reportId));
	await deleteReportedExample({
		reportId,
		resolution: buildResolution(
			QUIZ_REPORT_RESOLUTION_ACTIONS.EXAMPLE_DELETED,
			adminUserId,
			requireDecisionNote(report, QUIZ_REPORT_RECOMMENDATIONS.REPAIR, note)
		)
	});
}

export async function excludeReportedQuizVoca(
	reportId: string,
	adminUserId: string,
	note?: string
): Promise<void> {
	const report = requirePendingReport(await findQuizReportById(reportId));
	await excludeReportedVoca({
		reportId,
		resolution: buildResolution(
			QUIZ_REPORT_RESOLUTION_ACTIONS.VOCA_EXCLUDED,
			adminUserId,
			requireDecisionNote(report, QUIZ_REPORT_RECOMMENDATIONS.EXCLUDE, note)
		)
	});
}

export async function submitQuizReport(reportData: QuizReportCreate): Promise<void> {
	const selectedIssues = new Set(reportData.issues);
	const issues = Object.values(QUIZ_REPORT_ISSUES).filter((issue) => selectedIssues.has(issue));
	if (issues.length === 0) throw new Error('신고 유형을 하나 이상 선택해 주세요.');
	const details = reportData.details?.trim();
	const [voca, quizCard] = await Promise.all([
		getVocaById(reportData.vocaId),
		findQuizCardByVocaId(reportData.vocaId)
	]);
	const quizExample = quizCard?.examples.find(
		(example) => example._id === reportData.quizExampleId
	);
	if (quizExample == null) throw new Error('신고할 예문을 찾을 수 없습니다.');

	await createQuizReport({
		...reportData,
		issues,
		...(details == null || details === '' ? { details: undefined } : { details }),
		vocaSnapshot: buildQuizReportVocaSnapshot(voca),
		quizExampleSnapshot: quizExample
	});
}
