<script lang="ts">
	import AddHiddenInputs from './AddHiddenInputs.svelte';

	import type { AddContextValues } from '../add-view';
	import type { SubmitFunction } from '@sveltejs/kit';

	import { enhance } from '$app/forms';

	let {
		context,
		createdVocaId,
		queuedForReview,
		wasAlreadyRegistered,
		isAlreadyLearning,
		error,
		onAddAnother
	}: {
		context: AddContextValues;
		createdVocaId: string;
		queuedForReview: boolean;
		wasAlreadyRegistered: boolean;
		isAlreadyLearning: boolean;
		error?: string;
		onAddAnother: () => void;
	} = $props();

	let isSubmitting = $state(false);

	const memorize: SubmitFunction = () => {
		isSubmitting = true;

		return async ({ update }) => {
			try {
				await update();
			} finally {
				isSubmitting = false;
			}
		};
	};
</script>

<section class="add-card">
	<h2>{wasAlreadyRegistered ? '이미 등록된 단어예요' : '단어를 추가했어요'}</h2>
	<p>
		{wasAlreadyRegistered
			? '예문을 새로 만들지 않고 기존에 저장된 단어를 사용해요.'
			: '예문 생성과 저장을 성공적으로 마쳤어요.'}
	</p>

	{#if error}
		<aside class="post-it add-error" role="alert">{error}</aside>
	{/if}

	<div>
		{#if !queuedForReview && !isAlreadyLearning}
			<form method="POST" action="?/memorize" aria-busy={isSubmitting} use:enhance={memorize}>
				<AddHiddenInputs {context} />
				<input name="createdVocaId" type="hidden" value={createdVocaId} />
				<input name="wasAlreadyRegistered" type="hidden" value={String(wasAlreadyRegistered)} />
				<button class="button" type="submit" disabled={isSubmitting}>
					{isSubmitting ? '추가 중…' : '이 단어 암기하기'}
				</button>
			</form>
		{/if}
		<button type="button" class="button secondary" onclick={onAddAnother} disabled={isSubmitting}>
			다른 단어 추가하기
		</button>
	</div>

	{#if queuedForReview}
		<p class="add-hint" aria-live="polite">암기할 단어에 추가했어요.</p>
		<!-- {:else if isAlreadyLearning}
		<p class="add-hint">이미 암기 중인 단어예요.</p> -->
	{/if}
</section>

<style>
	section > div {
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: var(--spacing-3);
	}
</style>
