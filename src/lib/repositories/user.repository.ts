import type { UserEntity, UserCreate } from '$lib/shared/types/user.type';

import UserModel from '$lib/models/user.model';
import { toPojo } from '$lib/shared/utils/general.util';

export async function findUserById(userId: string): Promise<UserEntity | null> {
	const raw = await UserModel.findById(userId).lean();
	return raw == null ? null : toPojo<UserEntity>(raw);
}

export async function getUserById(userId: string): Promise<UserEntity> {
	const currentUser = await findUserById(userId);

	if (currentUser == null) {
		throw new Error(`User not found: ${userId}`);
	}

	return currentUser;
}

export async function findUsersByIds(userIds: string[]): Promise<UserEntity[]> {
	const documents = await UserModel.find({ _id: { $in: userIds } }).lean();
	return documents.map(toPojo<UserEntity>);
}

export async function createUser(userId: string, userData: UserCreate): Promise<UserEntity> {
	const document = await UserModel.create({
		_id: userId,
		...userData
	});

	return toPojo(document.toObject());
}

export async function saveUser(currentUser: UserEntity): Promise<UserEntity> {
	const { _id, createdAt: _createdAt, updatedAt: _updatedAt, ...userData } = currentUser;
	const document = await UserModel.findOneAndUpdate(
		{ _id },
		{ $set: toPojo(userData) },
		{ returnDocument: 'after' }
	).lean();

	if (document == null) {
		throw new Error(`User not found: ${_id}`);
	}

	return toPojo(document);
}
