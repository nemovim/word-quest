<script lang="ts">
	import type { QuizEncounter } from '$lib/shared/types/quiz.type';

	let { encounter }: { encounter: QuizEncounter } = $props();
</script>

<header aria-label="학습 진행">
	<span class="word-info">
		<span>{encounter.isNew ? '새 단어' : `복습 ${encounter.reviewStage}단계`}</span>
		<span>난이도 {encounter.difficultyLevel}</span>
		<span>활용도 {encounter.utilityScore}</span>
	</span>
</header>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--ink-soft);
		padding: 0 0.2rem;
	}
	.word-info {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.7rem;
	}
	.word-info > span {
		white-space: nowrap;
	}
</style>
