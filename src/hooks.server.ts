import { redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

import { handle as authenticationHandle } from './auth.js';

import type { Handle } from '@sveltejs/kit';

import { initDb } from '$lib/server/db';
import { getOrCreateUser } from '$lib/service/user.service';

export const init = async () => {
	await initDb();
};

const authorizationHandle: Handle = async ({ event, resolve }) => {
	const session = await event.locals.auth();

	if (session?.user?.id && session?.user?.email && session?.user?.name) {
		if (event.url.pathname.startsWith('/signin')) {
			throw redirect(303, '/');
		}

		const user = await getOrCreateUser(session.user.id, session.user.email, session.user.name);

		event.locals.user = user;
		return await resolve(event);
	} else if (event.url.pathname.startsWith('/signin')) {
		return await resolve(event);
	} else {
		throw redirect(303, '/signin');
	}
};

export const handle = sequence(authenticationHandle, authorizationHandle);
