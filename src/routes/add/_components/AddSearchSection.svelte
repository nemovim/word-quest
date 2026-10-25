<script lang="ts">
	import AddFields from './AddFields.svelte';
	import AddHiddenInputs from './AddHiddenInputs.svelte';
	import AddVocaSummary from './AddVocaSummary.svelte';

	import type { AddContextValues, AddVocaSummary as AddVocaSummaryData } from '../add-view';
	import type { SubmitFunction } from '@sveltejs/kit';

	import { enhance } from '$app/forms';

	let {
		context,
		options,
		selectedVocaId,
		error
	}: {
		context: AddContextValues;
		options: AddVocaSummaryData[] | null;
		selectedVocaId: string | null | undefined;
		error?: string;
	} = $props();

	let isGenerating = $state(false);
	let isSearching = $state(false);
	let isBusy = $derived(isSearching || isGenerating);

	const search: SubmitFunction = () => {
		isSearching = true;

		return async ({ update }) => {
			try {
				await update();
			} finally {
				isSearching = false;
			}
		};
	};

	const generateExamples: SubmitFunction = () => {
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

<form method="POST" action="?/search" class="add-card" aria-busy={isSearching} use:enhance={search}>
	<h2>사전에서 찾기</h2>
	<AddFields sourceText={context.sourceText} disabled={isBusy} />
	{#if error}
		<aside class="post-it add-error" role="alert">{error}</aside>
	{/if}
	<button class="button" type="submit" disabled={isBusy}>
		{isSearching ? '찾는 중…' : '찾아보기'}
	</button>
</form>

{#if options != null}
	<section class="add-card">
		<h2>검색 결과</h2>

		{#if options.length === 0}
			<p class="add-hint">일치하는 단어가 없어요.</p>
		{:else}
			<form
				method="POST"
				action="?/create"
				class="add-form"
				aria-busy={isGenerating}
				use:enhance={generateExamples}
			>
				<AddHiddenInputs {context} />

				<div class="add-list">
					{#each options as option (option._id)}
						<label class="add-choice">
							<input
								type="radio"
								name="selectedVocaId"
								value={option._id}
								checked={selectedVocaId === option._id}
								disabled={isBusy}
								required
							/>

							<div class="add-copy">
								<AddVocaSummary voca={option} />
							</div>
						</label>
					{/each}
				</div>

				<button class="button" type="submit" disabled={isBusy}>
					{isGenerating ? '예문 생성 중…' : '예문 생성하기'}
				</button>
			</form>
		{/if}
	</section>
{/if}
