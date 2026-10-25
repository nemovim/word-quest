<script lang="ts">
	import type { AddVocaSummary } from '../add-view';

	let {
		voca,
		showScores = false
	}: {
		voca: AddVocaSummary;
		showScores?: boolean;
	} = $props();
</script>

<p><b>한국어:</b> {voca.sourceText}</p>
<p><b>뜻:</b> {voca.sourceDefinition}</p>
<p><b>외울 단어:</b> {voca.targetText}</p>
<!-- {#if voca.targetDefinition}
	<p><b>외국어 풀이</b> {voca.targetDefinition}</p>
{/if} -->
{#if showScores}
	<p><b>난이도</b> {voca.difficultyLevel ?? '-'}/10 · <b>활용도</b> {voca.utilityScore ?? '-'}/5</p>
{/if}
