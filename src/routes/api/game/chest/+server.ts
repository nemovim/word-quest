import { json, error } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

import { openChest } from '$lib/server/game';
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	if (typeof body?.id !== 'string' || body.id.length > 100) error(400, '상자를 선택해 주세요.');
	return json(await openChest(locals.user, body.id));
};
