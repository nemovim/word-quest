import { json } from '@sveltejs/kit';

import { parseCombatPayload, parseCheckPayload } from '../payload';

import type { RequestHandler } from './$types';

import { getUserById } from '$lib/repositories/user.repository';
import { getVocaById } from '$lib/repositories/voca.repository';
import { assertExploring, hurtPlayer, rewardStudy } from '$lib/server/game';
import { NewVocaLimitError } from '$lib/service/new-voca-limit.service';
import { checkQuizAnswer, revealQuizAnswer } from '$lib/usecases/quiz.usecase';

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const { sessionId, actionId } = await parseCombatPayload(request);
		await assertExploring(locals.user, sessionId);
		const payload = await parseCheckPayload(request);
		const word = await getVocaById(payload.vocaId);
		const result = await checkQuizAnswer({ ...payload, user: locals.user });
		const combat =
			result.status === 'correct'
				? await rewardStudy(
						await getUserById(locals.user._id),
						`${sessionId}:${actionId}`,
						sessionId
					)
				: await hurtPlayer(locals.user, sessionId, actionId, word.difficultyLevel ?? 1);
		const answer =
			result.status === 'wrong' && combat.player?.hp === 0 ? await revealQuizAnswer(payload) : {};
		return json({ ...result, ...answer, combat });
	} catch (error) {
		if (error instanceof NewVocaLimitError) {
			return new Response(error.message, { status: 429 });
		}

		throw error;
	}
};
