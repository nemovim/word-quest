import { json } from '@sveltejs/kit';

import { parseCombatPayload, parsePassPayload } from '../payload';

import type { RequestHandler } from './$types';

import { getVocaById } from '$lib/repositories/voca.repository';
import { assertExploring, healMonster } from '$lib/server/game';
import { NewVocaLimitError } from '$lib/service/new-voca-limit.service';
import { passQuizAnswer } from '$lib/usecases/quiz.usecase';

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const { sessionId, actionId } = await parseCombatPayload(request);
		await assertExploring(locals.user, sessionId);
		const payload = await parsePassPayload(request);
		const word = await getVocaById(payload.vocaId);
		const result = await passQuizAnswer({ ...payload, user: locals.user });
		const combat = await healMonster(
			locals.user,
			`${sessionId}:${actionId}`,
			word.difficultyLevel ?? 1,
			sessionId
		);
		return json({ ...result, combat });
	} catch (error) {
		if (error instanceof NewVocaLimitError) {
			return new Response(error.message, { status: 429 });
		}

		throw error;
	}
};
