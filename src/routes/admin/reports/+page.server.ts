import { fail } from '@sveltejs/kit';

import type { LanguageCode } from '$lib/shared/types/general.type';
import type { QuizReportAdminDraft } from '$lib/shared/types/quiz-report.type';
import type { PartOfSpeech } from '$lib/shared/types/voca.type';
import type { Actions, PageServerLoad } from './$types';

import { requireAdminUser } from '$lib/server/admin';
import { QUIZ_REPORT_APPLY_SECTIONS } from '$lib/shared/types/quiz-report.type';
import {
	acceptLatestQuizReportProposal,
	applyQuizReportAdminDraft,
	deleteReportedQuizExample,
	dismissQuizReport,
	excludeReportedQuizVoca,
	generateQuizReportProposal,
	loadQuizReportItems
} from '$lib/usecases/quiz-report.usecase';

function readText(formData: FormData, name: string, required = false): string | undefined {
	const value = formData.get(name);
	const normalized = typeof value === 'string' ? value.trim() : '';
	if (required && normalized === '') throw new Error(`${name} 값이 필요합니다.`);
	return normalized === '' ? undefined : normalized;
}

async function runAction(
	request: Request,
	action: (formData: FormData) => Promise<void>,
	message: string
) {
	try {
		await action(await request.formData());
		return { success: true as const, message };
	} catch (actionError) {
		return fail(400, {
			success: false as const,
			error: actionError instanceof Error ? actionError.message : '요청을 처리하지 못했습니다.'
		});
	}
}

function reportAction(
	adminUserId: string,
	action: (reportId: string, adminUserId: string, note?: string) => Promise<void>
) {
	return async (formData: FormData) =>
		action(readText(formData, 'reportId', true) as string, adminUserId, readText(formData, 'note'));
}

function readNullableInteger(formData: FormData, name: string): number | null {
	const value = readText(formData, name);
	if (value == null) return null;
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) throw new Error(`${name} 값이 올바르지 않습니다.`);
	return parsed;
}

function readAdminDraft(formData: FormData): QuizReportAdminDraft {
	const sectionValues = new Set(formData.getAll('sections'));
	const sections = Object.values(QUIZ_REPORT_APPLY_SECTIONS).filter((section) =>
		sectionValues.has(section)
	);
	return {
		proposalAttemptId: readText(formData, 'proposalAttemptId', true) as string,
		sections,
		proposedVoca: {
			sourceText: readText(formData, 'sourceText', true) as string,
			sourceDefinition: readText(formData, 'sourceDefinition', true) as string,
			partOfSpeech: readText(formData, 'partOfSpeech', true) as PartOfSpeech,
			targetLang: readText(formData, 'targetLang', true) as LanguageCode,
			targetText: readText(formData, 'targetText', true) as string,
			targetDefinition: readText(formData, 'targetDefinition', true) as string,
			difficultyLevel: readNullableInteger(formData, 'difficultyLevel'),
			utilityScore: readNullableInteger(formData, 'utilityScore')
		},
		proposedExample: {
			_id: '',
			sourceSentenceTemplate: readText(formData, 'sourceSentenceTemplate', true) as string,
			sourceFillText: readText(formData, 'sourceFillText', true) as string,
			targetSentenceTemplate: readText(formData, 'targetSentenceTemplate', true) as string,
			targetFillText: readText(formData, 'targetFillText', true) as string,
			targetPronunciationText: readText(formData, 'targetPronunciationText', true) as string,
			reportCount: 0,
			addedAt: ''
		}
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	requireAdminUser(locals.user);
	return { reports: await loadQuizReportItems() };
};

export const actions = {
	accept: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return runAction(
			request,
			(formData) =>
				acceptLatestQuizReportProposal(
					readText(formData, 'reportId', true) as string,
					locals.user._id
				),
			'AI 수정안을 적용했습니다.'
		);
	},
	generate: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return runAction(
			request,
			(formData) =>
				generateQuizReportProposal(
					readText(formData, 'reportId', true) as string,
					readText(formData, 'instruction')
				),
			'AI 제안을 생성했습니다.'
		);
	},
	retry: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return runAction(
			request,
			(formData) =>
				generateQuizReportProposal(
					readText(formData, 'reportId', true) as string,
					readText(formData, 'instruction', true)
				),
			'관리자 지시를 반영한 새 AI 제안을 생성했습니다.'
		);
	},
	apply: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return runAction(
			request,
			async (formData) =>
				applyQuizReportAdminDraft(
					readText(formData, 'reportId', true) as string,
					locals.user._id,
					readAdminDraft(formData),
					readText(formData, 'note')
				),
			'선택한 수정 사항을 적용했습니다.'
		);
	},
	deleteExample: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return runAction(
			request,
			reportAction(locals.user._id, deleteReportedQuizExample),
			'신고된 예문을 삭제했습니다.'
		);
	},
	exclude: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return runAction(
			request,
			reportAction(locals.user._id, excludeReportedQuizVoca),
			'단어를 퀴즈에서 영구 제외했습니다.'
		);
	},
	dismiss: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return runAction(
			request,
			reportAction(locals.user._id, dismissQuizReport),
			'신고를 기각했습니다.'
		);
	}
} satisfies Actions;
