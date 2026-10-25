<script lang="ts">
	import AddHiddenInputs from './AddHiddenInputs.svelte';
	import AddPreviewLine from './AddPreviewLine.svelte';
	import AddVocaSummary from './AddVocaSummary.svelte';

	import type { QuizExample } from '$lib/shared/types/quiz-card.type';
	import type { AddContextValues, AddVocaSummary as AddVocaSummaryData } from '../add-view';
	import type { SubmitFunction } from '@sveltejs/kit';

	import { enhance } from '$app/forms';

	let {
		context,
		reviewVoca,
		reviewExamples,
		selectedExampleIndices,
		selectedVocaId,
		pendingReviewJson,
		pendingReviewSignature,
		error,
		onCancel
	}: {
		context: AddContextValues;
		reviewVoca: AddVocaSummaryData;
		reviewExamples: QuizExample[];
		selectedExampleIndices: number[];
		selectedVocaId: string;
		pendingReviewJson: string | undefined;
		pendingReviewSignature: string | undefined;
		error?: string;
		onCancel: () => void;
	} = $props();

	let pendingAction = $state<'save' | 'regenerate' | null>(null);
	let isSubmitting = $derived(pendingAction !== null);

	const submit =
		(action: 'save' | 'regenerate'): SubmitFunction =>
		() => {
			pendingAction = action;

			return async ({ update }) => {
				try {
					await update();
				} finally {
					pendingAction = null;
				}
			};
		};
</script>

<section class="add-card">
	<h2>저장할 예문 고르기</h2>
	<AddVocaSummary voca={reviewVoca} showScores />

	{#if error}
		<aside class="post-it add-error" role="alert">{error}</aside>
	{/if}

	<form
		method="POST"
		action="?/save"
		class="add-form"
		aria-busy={isSubmitting}
		use:enhance={submit('save')}
	>
		<AddHiddenInputs {context} />
		<input name="selectedVocaId" type="hidden" value={selectedVocaId} />
		<input name="pendingReviewJson" type="hidden" value={pendingReviewJson ?? ''} />
		<input name="pendingReviewSignature" type="hidden" value={pendingReviewSignature ?? ''} />

		<div class="add-list">
			{#each reviewExamples as example, index (example._id)}
				<label class="add-choice">
					<input
						type="checkbox"
						name="selectedExampleIndex"
						value={index}
						checked={selectedExampleIndices.includes(index)}
						disabled={isSubmitting}
					/>

					<div class="add-copy">
						<AddPreviewLine
							label="한국어 문장"
							template={example.sourceSentenceTemplate}
							fillText={example.sourceFillText}
						/>
						<AddPreviewLine
							label="외국어 문장"
							template={example.targetSentenceTemplate}
							fillText={example.targetFillText}
						/>
					</div>
				</label>
			{/each}
		</div>

		<div class="review-actions">
			<button type="button" class="button secondary" onclick={onCancel} disabled={isSubmitting}>
				취소하기
			</button>
			<button class="button" type="submit" disabled={isSubmitting}>
				{pendingAction === 'save' ? '저장 중…' : '선택한 예문 저장하기'}
			</button>
		</div>
	</form>

	<form
		method="POST"
		action="?/create"
		class="add-form"
		aria-busy={pendingAction === 'regenerate'}
		use:enhance={submit('regenerate')}
	>
		<AddHiddenInputs {context} />
		<input name="selectedVocaId" type="hidden" value={selectedVocaId} />
		<button type="submit" class="button secondary" disabled={isSubmitting}>
			{pendingAction === 'regenerate' ? '다시 만드는 중…' : '다시 만들기'}
		</button>
	</form>

	<style>
		.review-actions {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: var(--spacing-3);
		}
	</style>
</section>
