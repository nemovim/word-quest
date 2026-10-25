<script lang="ts">
	type Tone = 'info' | 'warn';

	let { label, tone = 'info' }: { label: string; tone?: Tone } = $props();
</script>

<span class="tag post-it" data-tone={tone}>{label}</span>

<style>
	.tag {
		display: inline-block;
		padding: var(--spacing-2) var(--spacing-4);
		background: var(--blue);
		font-size: var(--text-sm);
		font-weight: 700;
		line-height: 1.2;
		color: var(--ink);
	}

	.tag[data-tone='warn'] {
		background: var(--red-soft);
		color: var(--red);
	}
</style>
