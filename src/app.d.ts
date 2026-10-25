import type { User } from '$lib/shared/types/user.type';

declare global {
	namespace App {
		interface Locals {
			user: User;
		}
	}
}

export {};
