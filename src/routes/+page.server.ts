import { fail, isHttpError } from '@sveltejs/kit';

import type { Actions, PageServerLoad } from './$types';

import { loadGameView } from '$lib/server/game';
import { actGame } from '$lib/server/game-actions';
import { loadSummary } from '$lib/usecases/dashboard.usecase';

export const load: PageServerLoad = async ({ locals }) => {
	const [game, summary] = await Promise.all([loadGameView(locals.user), loadSummary(locals.user)]);
	return { user: locals.user, game, summary };
};
export const actions: Actions = {
	default: async ({ locals, request }) => {
		try {
			const form = await request.formData();
			if (!['upgrade', 'memory-upgrade', 'rebirth'].includes(String(form.get('action'))))
				return fail(400, { message: '학습은 던전 학습 메뉴에서 진행해 주세요.' });
			return await actGame(locals.user, form);
		} catch (cause) {
			if (isHttpError(cause)) return fail(cause.status, { message: cause.body.message });
			console.error('Game action failed', cause);
			return fail(500, { message: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' });
		}
	}
};
