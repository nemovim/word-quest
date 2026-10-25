import { fail } from '@sveltejs/kit';

import type { Actions, PageServerLoad } from './$types';

import { countVocasWithExamples } from '$lib/repositories/quiz-card.repository';
import { getRequestUserId } from '$lib/server/request-user.util';
import {
	handleCreateAction,
	handleMemorizeAction,
	handleSaveAction,
	handleSearchAction
} from '$lib/usecases/voca.usecase';

export const load: PageServerLoad = async () => ({
	vocaWithExamplesCount: await countVocasWithExamples()
});

export const actions = {
	search: async ({ request }) => {
		const result = await handleSearchAction(await request.formData());

		if (!result.success) {
			return fail(result.status, result);
		}

		return result;
	},
	create: async ({ locals, request }) => {
		const result = await handleCreateAction(getRequestUserId(locals), await request.formData());

		if (!result.success) {
			return fail(result.status, result);
		}

		return result;
	},
	save: async ({ locals, request }) => {
		const result = await handleSaveAction(getRequestUserId(locals), await request.formData());

		if (!result.success) {
			return fail(result.status, result);
		}

		return result;
	},
	memorize: async ({ locals, request }) => {
		const result = await handleMemorizeAction(getRequestUserId(locals), await request.formData());

		if (!result.success) {
			return fail(result.status, result);
		}

		return result;
	}
} satisfies Actions;
