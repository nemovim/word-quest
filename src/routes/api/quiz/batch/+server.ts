import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { assertExploring, beginExploration, refreshPlayer } from '$lib/server/game';
import { loadQuizPage, parseDirectionMode } from '$lib/usecases/quiz.usecase';

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	if (body.start === true) return json(await beginExploration(locals.user));
	if (body.health === true) return json(await refreshPlayer(locals.user, body.sessionId));
	await assertExploring(locals.user, body.sessionId);
	return json(await loadQuizPage(locals.user, parseDirectionMode(body.direction)));
};
