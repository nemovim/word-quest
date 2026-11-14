import { fail } from '@sveltejs/kit';

import type { Actions, PageServerLoad } from './$types';

import { requireAdminUser } from '$lib/server/admin';
import { listDeferredExamples, resolveDeferredExample } from '$lib/server/deferred-example';

export const load: PageServerLoad = async ({ locals }) => {
	requireAdminUser(locals.user);
	return { examples: await listDeferredExamples() };
};

async function run(request: Request, action: 'retry' | 'approve' | 'reject') {
	try {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const item = (await listDeferredExamples()).find((example) => example._id === id);
		if (!item) throw new Error('보류 항목을 찾을 수 없습니다.');
		const input =
			action === 'approve'
				? {
						...item.input,
						sourceSentence: String(form.get('sourceSentence') ?? '').trim(),
						sourceAnswer: String(form.get('sourceAnswer') ?? '').trim(),
						targetSentence: String(form.get('targetSentence') ?? '').trim(),
						targetAnswer: String(form.get('targetAnswer') ?? '').trim(),
						targetPronunciation: String(form.get('targetPronunciation') ?? '').trim()
					}
				: undefined;
		const status = await resolveDeferredExample(id, action, input);
		return {
			success: true,
			message:
				status === 'pending'
					? '재검토 후에도 불확실해 보류합니다.'
					: status === 'accepted'
						? '예문을 저장했습니다.'
						: '예문을 제외했습니다.'
		};
	} catch (error) {
		return fail(400, {
			success: false,
			message: error instanceof Error ? error.message : '처리하지 못했습니다.'
		});
	}
}

export const actions: Actions = {
	retry: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return run(request, 'retry');
	},
	approve: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return run(request, 'approve');
	},
	reject: async ({ locals, request }) => {
		requireAdminUser(locals.user);
		return run(request, 'reject');
	},
	retryAll: async ({ locals }) => {
		requireAdminUser(locals.user);
		const items = await listDeferredExamples(25);
		const counts = { accepted: 0, rejected: 0, pending: 0, failed: 0 };
		for (const item of items) {
			try {
				counts[await resolveDeferredExample(item._id, 'retry')]++;
			} catch {
				counts.failed++;
			}
		}
		return {
			success: true,
			message: `재검토 ${items.length}개: 저장 ${counts.accepted}, 제외 ${counts.rejected}, 보류 ${counts.pending}, 오류 ${counts.failed}`
		};
	}
};
