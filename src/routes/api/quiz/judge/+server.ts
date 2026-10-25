import { json } from '@sveltejs/kit';

import { parseJudgePayload } from '../payload';

import type { RequestHandler } from './$types';

import { judgeQuizAnswer } from '$lib/usecases/quiz.usecase';

export const POST: RequestHandler = async ({ request }) => {
	return json(await judgeQuizAnswer(await parseJudgePayload(request)));
};
