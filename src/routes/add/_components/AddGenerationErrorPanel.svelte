<script lang="ts">
	import AddHiddenInputs from './AddHiddenInputs.svelte';

	import type { AddContextValues } from '../add-view';
	import type { SubmitFunction } from '@sveltejs/kit';

	import { enhance } from '$app/forms';

	let {
		context,
		selectedVocaId,
		error,
		onCancel
	}: {
		context: AddContextValues;
		selectedVocaId: string;
		error: string;
		onCancel: () => void;
	} = $props();

	let isGenerating = $state(false);

	const regenerateExamples: SubmitFunction = () => {
		isGenerating = true;

		return async ({ update }) => {
			try {
				await update();
			} finally {
				isGenerating = false;
			}
		};
	};
</script>

<section class="add-card" aria-live="polite">
	<h2>예문 생성에 실패했어요</h2>
	<aside class="post-it add-error" role="alert">{error}</aside>
	<p>다시 생성하거나 다른 단어를 추가해 주세요.</p>

	<div>
		<form method="POST" action="?/create" aria-busy={isGenerating} use:enhance={regenerateExamples}>
			<AddHiddenInputs {context} />
			<input name="selectedVocaId" type="hidden" value={selectedVocaId} />
			<button class="button" type="submit" disabled={isGenerating}>
				{isGenerating ? '예문 재생성 중…' : '예문 재생성하기'}
			</button>
		</form>
		<button type="button" class="button secondary" onclick={onCancel} disabled={isGenerating}>
			다른 단어 추가하기
		</button>
	</div>
</section>

<style>
	section > div {
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: var(--spacing-3);
	}
</style>
