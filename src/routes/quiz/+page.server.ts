import type { PageServerLoad } from './$types';

import { loadGameView } from '$lib/server/game';
import { loadQuizPage, parseDirectionMode } from '$lib/usecases/quiz.usecase';

export const load: PageServerLoad = async ({ locals, url }) => {
	const [quiz, game] = await Promise.all([
		loadQuizPage(locals.user, parseDirectionMode(url.searchParams.get('direction'))),
		loadGameView(locals.user)
	]);
	return { ...quiz, game };
};
