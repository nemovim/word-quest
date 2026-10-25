import type { LayoutServerLoad } from './$types';

import { isAdminUser } from '$lib/server/admin';

export const load: LayoutServerLoad = async ({ locals }) => ({
	isAdmin: isAdminUser(locals.user)
});
