<script lang="ts">
	import type { SolvedResult } from '../quiz-result';

	let {
		solvedResult,
		onNext
	}: {
		solvedResult: SolvedResult;
		onNext: () => void;
	} = $props();

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.isComposing || event.repeat) {
			return;
		}

		event.preventDefault();
		onNext();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="solved-panel">
	<div>
		<strong>{solvedResult.correctAnswer}</strong>
		<small>[{solvedResult.pronunciationText}]</small><small class="review"
			>{solvedResult.status === 'pass' ? '넘김 · ' : ''}{solvedResult.nextReviewLabel} 뒤 복습</small
		>
	</div>
	<button type="button" class="button" onclick={onNext}>다음 →</button>
</section>

<style>
	.solved-panel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.2rem;
	}
	button {
		white-space: nowrap;
	}
	small {
		color: var(--ink-soft);
		font-size: 0.8rem;
	}
	.review {
		display: block;
		margin-top: 0.2rem;
	}
</style>
