<script lang="ts">
	import { resolve } from '$app/paths';
	let {
		count,
		bossCount = 0,
		href,
		onOpen,
		trigger = $bindable()
	}: {
		count: number;
		bossCount?: number;
		href?: '/quiz';
		onOpen?: () => void;
		trigger?: HTMLButtonElement;
	} = $props();
</script>

{#snippet contents()}
	<span class="chest-art" aria-hidden="true">
		<svg viewBox="0 0 72 62" fill="none">
			{#if count > 1}<path
					d="M17 16h42v33H17Z"
					fill="#dac29f"
					stroke="#b8956b"
					stroke-width="2"
					transform="rotate(9 38 32)"
				/>{/if}
			<path
				d="M10 27h48v26H10Z"
				fill="#bb8655"
				stroke="#795535"
				stroke-width="2.5"
				stroke-linejoin="round"
			/>
			<path
				d="M10 27v-6q0-12 12-12h24q12 0 12 12v6Z"
				fill="#d7ab73"
				stroke="#795535"
				stroke-width="2.5"
			/>
			<path d="M19 11v40m29-40v40M10 29h48" stroke="#efd49e" stroke-width="4" />
			<rect
				x="29"
				y="24"
				width="10"
				height="13"
				rx="3"
				fill="#f1d69c"
				stroke="#8a623b"
				stroke-width="2"
			/>
			<path d="M34 28v5" stroke="#8a623b" stroke-width="2" stroke-linecap="round" />
			<path d="m62 6 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#c69a53" />
		</svg>
		<b>{count}</b>
	</span>
{/snippet}
{#if href}
	<a
		class="stash"
		href={resolve(href)}
		aria-label={`보물상자 ${count}개 보러가기`}
		title={`보물상자 ${count}개${bossCount ? ` · 보스 ${bossCount}개` : ''}`}
		>{@render contents()}</a
	>
{:else}
	<button
		class="stash"
		type="button"
		bind:this={trigger}
		onclick={onOpen}
		title={`보물상자 ${count}개${bossCount ? ` · 보스 ${bossCount}개` : ''}`}
		aria-label={`보물상자 열기 (${count}개)`}>{@render contents()}</button
	>
{/if}

<style>
	.stash {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: auto;
		min-width: 44px;
		min-height: 44px;
		padding: 3px;
		border: 0;
		border-radius: 0.6rem;
		background: transparent;
		color: var(--brown);
		text-decoration: none;
		font: inherit;
		cursor: pointer;
		transition:
			background 0.15s,
			transform 0.15s;
	}
	.stash:hover {
		background: var(--paper-deep);
	}
	.stash:active {
		transform: scale(0.94);
	}
	.stash:focus-visible {
		outline: 2px solid var(--brown);
		outline-offset: 2px;
	}
	.chest-art {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	svg {
		display: block;
		width: 32px;
		height: 32px;
	}
	b {
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}
	@media (prefers-reduced-motion: reduce) {
		.stash {
			transition: none;
		}
	}
</style>
