import { error } from '@sveltejs/kit';

export function getRequestUserId(locals: App.Locals): string {
	const userId = locals.user?._id;

	if (userId == null || userId === '') {
		throw error(401, 'Unauthorized');
	}

	return userId;
}
