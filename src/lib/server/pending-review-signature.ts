import { createHmac, timingSafeEqual } from 'node:crypto';

import { AUTH_SECRET } from '$env/static/private';

function createSignature(userId: string, pendingReviewJson: string): Buffer {
	// Preserve signatures for reviews started before the app rename.
	return createHmac('sha256', AUTH_SECRET)
		.update('word-note:pending-review:v1')
		.update('\0')
		.update(userId)
		.update('\0')
		.update(pendingReviewJson)
		.digest();
}

export function signPendingReview(userId: string, pendingReviewJson: string): string {
	return createSignature(userId, pendingReviewJson).toString('base64url');
}

export function verifyPendingReviewSignature(
	userId: string,
	pendingReviewJson: string,
	signature: string
): boolean {
	if (signature === '') {
		return false;
	}

	const expected = createSignature(userId, pendingReviewJson);
	const received = Buffer.from(signature, 'base64url');

	return received.length === expected.length && timingSafeEqual(received, expected);
}
