<script lang="ts">
	import AddCreatedPanel from './_components/AddCreatedPanel.svelte';
	import AddCreateSection from './_components/AddCreateSection.svelte';
	import AddGenerationErrorPanel from './_components/AddGenerationErrorPanel.svelte';
	import AddReviewPanel from './_components/AddReviewPanel.svelte';
	import AddSearchSection from './_components/AddSearchSection.svelte';

	import type { ActionData, PageData } from './$types';
	import type { AddContextValues } from './add-view';

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { LANGUAGE_CODES } from '$lib/shared/types/general.type';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let isDirectAdding = $state(false);
	let directSearchText = $state('');

	const context = $derived<AddContextValues>({
		sourceText: form?.sourceText ?? '',
		targetLang: form?.targetLang ?? LANGUAGE_CODES.EN,
		targetText: form?.targetText ?? '',
		meaningHint: form?.meaningHint ?? ''
	});
	const createdResult = $derived(form?.success === true && form.step === 'create' ? form : null);
	const reviewResult = $derived(form?.step === 'review' ? form : null);
	const generationError = $derived(
		form?.success === false && form.step === 'generate-error' ? form : null
	);
	const canDirectAdd = $derived(
		form?.options != null && !(form.success === false && form.step === 'search')
	);

	function resetToSearch(): void {
		isDirectAdding = false;
		directSearchText = '';
		void goto(resolve('/add'), { invalidateAll: true, replaceState: true });
	}
</script>

<header>
	<h1>단어 추가</h1>
	<p>한국어나 영어 단어로 검색하고, 원하는 뜻과 예문을 골라 저장해요.</p>
	<small>지금까지 예문이 추가된 단어 {data.vocaWithExamplesCount.toLocaleString()}개</small>
</header>

<section>
	{#if createdResult}
		<AddCreatedPanel
			{context}
			createdVocaId={createdResult.createdVoca._id}
			queuedForReview={createdResult.queuedForReview}
			wasAlreadyRegistered={createdResult.wasAlreadyRegistered}
			isAlreadyLearning={createdResult.isAlreadyLearning}
			error={createdResult.error}
			onAddAnother={resetToSearch}
		/>
	{:else if reviewResult?.reviewVoca}
		<AddReviewPanel
			{context}
			reviewVoca={reviewResult.reviewVoca}
			reviewExamples={reviewResult.reviewExamples ?? []}
			selectedExampleIndices={reviewResult.selectedExampleIndices ?? []}
			selectedVocaId={reviewResult.selectedVocaId ?? ''}
			pendingReviewJson={reviewResult.pendingReviewJson}
			pendingReviewSignature={reviewResult.pendingReviewSignature}
			error={reviewResult.error}
			onCancel={resetToSearch}
		/>
	{:else if generationError}
		<AddGenerationErrorPanel
			{context}
			selectedVocaId={generationError.selectedVocaId ?? ''}
			error={generationError.error}
			onCancel={resetToSearch}
		/>
	{:else}
		{#if isDirectAdding}
			<AddCreateSection
				{context}
				searchedText={directSearchText}
				onCancel={resetToSearch}
				error={form?.error}
			/>
		{:else}
			<AddSearchSection
				{context}
				options={form?.options ?? null}
				selectedVocaId={form?.selectedVocaId}
				error={form?.step === 'search' ? form.error : undefined}
			/>
			{#if canDirectAdd}
				<div class="direct-add-action">
					<button
						type="button"
						class="button secondary"
						onclick={() => {
							directSearchText = context.sourceText;
							isDirectAdding = true;
						}}
					>
						원하는 뜻이 없나요? 직접 추가하기
					</button>
				</div>
			{/if}
		{/if}
	{/if}
</section>

<style>
	header {
		margin-bottom: var(--spacing-8);
	}

	header :is(h1, p) {
		margin: var(--spacing-1) 0;
	}

	header p {
		color: var(--ink-soft);
	}

	header small {
		display: block;
		margin-top: var(--spacing-2);
		color: var(--ink-soft);
	}

	section,
	:global(.add-card),
	:global(.add-form),
	:global(.add-list),
	:global(.add-copy) {
		display: grid;
		gap: var(--spacing-4);
	}

	.direct-add-action {
		display: flex;
		justify-content: flex-end;
	}

	:global(.add-card) {
		padding-block: var(--spacing-6);
		padding-inline: var(--spacing-8);
		background: var(--paper-soft);
		box-shadow: 0 0.35rem 1rem var(--shadow-soft);
	}

	:global(.add-card h2) {
		margin: 0;
	}

	:global(.add-card p) {
		margin: 0;
	}

	:global(.add-error) {
		padding-block: var(--spacing-3);
		padding-inline: var(--spacing-4);
		background: var(--red-soft);
		color: var(--red);
		font-weight: 700;
	}

	:global(.add-choice) {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--spacing-3);
		padding-block: var(--spacing-3);
		padding-inline: var(--spacing-4);
		background: var(--paper);
		border: 0.1rem solid var(--line);
	}

	:global(.add-choice > input) {
		width: 1.1rem;
		height: 1.1rem;
		margin-top: var(--spacing-1);
	}

	:global(.add-preview) {
		padding-block: var(--spacing-4);
		padding-inline: var(--spacing-5);
		background: var(--paper);
		box-shadow: 0 0.3rem 0.8rem var(--shadow);
	}

	:global(.add-preview small) {
		color: var(--ink-soft);
	}

	:global(.add-preview p) {
		margin: var(--spacing-1) 0 0;
		font-size: var(--text-base);
	}

	:global(.add-highlight),
	:global(.add-blank) {
		background: var(--yellow);
	}

	:global(.add-highlight) {
		padding-inline: var(--spacing-1);
		font-weight: 800;
	}

	:global(.add-blank) {
		display: inline-block;
		width: 7rem;
		height: 1em;
		vertical-align: -0.08em;
	}

	:global(.add-hint) {
		color: var(--ink-soft);
	}
</style>
