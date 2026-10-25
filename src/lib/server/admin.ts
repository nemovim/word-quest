import { error } from '@sveltejs/kit';

import type { User } from '$lib/shared/types/user.type';

function getAdminEmails(): Set<string> {
	return new Set(
		(process.env.ADMIN_EMAILS ?? '')
			.split(/[\s,]+/)
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean)
	);
}

export function isAdminUser(user: User | undefined): boolean {
	return user != null && getAdminEmails().has(user.email.trim().toLowerCase());
}

export function requireAdminUser(user: User | undefined): void {
	if (!isAdminUser(user)) {
		error(403, '관리자만 접근할 수 있습니다.');
	}
}
