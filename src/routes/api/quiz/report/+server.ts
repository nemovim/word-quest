import { json } from '@sveltejs/kit';

import { parseReportPayload } from '../payload';

import type { RequestHandler } from './$types';

import { submitQuizReport } from '$lib/usecases/quiz-report.usecase';

export const POST: RequestHandler = async ({ locals, request }) => {
	const payload = await parseReportPayload(request);
	await submitQuizReport({
		...payload,
		userId: locals.user._id
	});

	return json({ ok: true });
};
