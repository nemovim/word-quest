<script lang="ts">
	import { splitQuizTemplate } from '$lib/shared/utils/answer.util';

	let {
		label,
		template,
		fillText,
		blank = false
	}: {
		label: string;
		template: string;
		fillText: string;
		blank?: boolean;
	} = $props();

	const preview = $derived({
		...splitQuizTemplate(template),
		fillText
	});
</script>

<div>
	<small>{label}</small>
	<p>
		{preview.before}
		{#if blank}
			<span class="add-blank"></span>
		{:else}
			<span class="add-highlight">{preview.fillText}</span>
		{/if}
		{preview.after}
	</p>
</div>

<style lang="scss">
	p {
		font-size: var(--text-lg);
	}
</style>
