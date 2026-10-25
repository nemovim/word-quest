<script lang="ts">
	let { kind }: { kind: string } = $props();
	const silver = $derived(kind === 'silver' || kind === '은');
	const metal = $derived(silver || kind === 'iron' || kind === '철');
</script>

{#if metal}
	<svg class:silver viewBox="0 0 28 28" fill="none" aria-hidden="true">
		<path
			d="m4 18 4-10 12 1 5 10-13 5Z"
			fill={silver ? '#b9cad7' : '#626c78'}
			stroke={silver ? '#718b9e' : '#3d4753'}
			stroke-width="1.4"
			stroke-linejoin="round"
		/>
		<path d="m8 8 12 1-7 5-9 4Z" fill={silver ? '#edf6fc' : '#a1adba'} />
		<path d="m13 14 7-5 5 10-13 5Z" fill={silver ? '#d4e3ee' : '#7f8c9a'} />
		<path
			d="m13 14-1 10M4 18l9-4 12 5"
			stroke={silver ? '#91a9bc' : '#475360'}
			stroke-width="1.2"
			stroke-linejoin="round"
		/>
		{#if silver}<path
				d="m22 2 1.2 3.8L27 7l-3.8 1.2L22 12l-1.2-3.8L17 7l3.8-1.2Z"
				fill="#f8fdff"
				stroke="#8ca8bf"
				stroke-width="0.8"
			/>{/if}
	</svg>
{:else}
	<span aria-hidden="true">{kind === 'gold' || kind === '골드' ? '🪙' : '💎'}</span>
{/if}

<style>
	svg {
		display: inline-block;
		width: 1.3em;
		height: 1.3em;
		vertical-align: -0.25em;
		flex-shrink: 0;
	}
</style>
