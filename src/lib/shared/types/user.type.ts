import type { UserId } from '$lib/shared/types/general.type';

export type UserLevelHistory = {
	level: number;
	recordedAt: string;
};

export type UserCreate = {
	email: string;
	name: string;
	currentLevel: number;
	levelHistory: UserLevelHistory[];
};

export type UserEntity = UserCreate & {
	_id: UserId;
	createdAt: string;
	updatedAt: string;
};

export type User = UserEntity;
