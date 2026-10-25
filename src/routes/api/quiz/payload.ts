import { QUIZ_REPORT_ISSUES, type QuizReportIssue } from '$lib/shared/types/quiz-report.type';
import { parseQuizTarget } from '$lib/usecases/quiz.usecase';

type QuizActionPayload = {
	vocaId?: string;
	quizExampleId?: string;
	promptLang?: string;
	answerLang?: string;
	answerText?: string;
	isRetry?: boolean;
	regenerate?: boolean;
	issues?: unknown;
	details?: string;
};

function parseQuizReportIssues(value: unknown): QuizReportIssue[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error('Invalid quiz report issues.');
	}
	const issues = [...new Set(value)];
	if (
		issues.some(
			(issue) =>
				typeof issue !== 'string' ||
				!Object.values(QUIZ_REPORT_ISSUES).includes(issue as QuizReportIssue)
		)
	) {
		throw new Error('Invalid quiz report issues.');
	}
	return issues as QuizReportIssue[];
}

export async function parseCheckPayload(request: Request) {
	const payload = (await request.json()) as QuizActionPayload;

	if (
		typeof payload.answerText !== 'string' ||
		(payload.isRetry != null && typeof payload.isRetry !== 'boolean')
	) {
		throw new Error('Invalid quiz check request.');
	}

	return {
		...parseQuizTarget(payload),
		answerText: payload.answerText,
		isRetry: payload.isRetry ?? false
	};
}

export async function parsePassPayload(request: Request) {
	const payload = (await request.json()) as QuizActionPayload;
	return { ...parseQuizTarget(payload), isRetry: payload.isRetry === true };
}

export async function parseJudgePayload(request: Request) {
	const payload = (await request.json()) as QuizActionPayload;

	if (
		typeof payload.answerText !== 'string' ||
		(payload.regenerate != null && typeof payload.regenerate !== 'boolean')
	) {
		throw new Error('Invalid quiz judge request.');
	}

	return {
		...parseQuizTarget(payload),
		answerText: payload.answerText,
		regenerate: payload.regenerate ?? false
	};
}

export async function parseReportPayload(request: Request) {
	const payload = (await request.json()) as QuizActionPayload;
	const details = typeof payload.details === 'string' ? payload.details.trim() : undefined;

	if (details != null && details.length > 500) {
		throw new Error('Quiz report details are too long.');
	}

	return {
		...parseQuizTarget(payload),
		issues: parseQuizReportIssues(payload.issues),
		details: details === '' ? undefined : details
	};
}

export async function parseCombatPayload(request: Request) {
	const { sessionId, actionId } = await request.clone().json();
	if (
		typeof sessionId !== 'string' ||
		!sessionId ||
		sessionId.length > 100 ||
		typeof actionId !== 'string' ||
		!actionId ||
		actionId.length > 100
	)
		throw new Error('Invalid exploration request.');
	return { sessionId, actionId };
}
