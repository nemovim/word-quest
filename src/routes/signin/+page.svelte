<script lang="ts">
	import { onDestroy } from 'svelte';

	import GoogleModule from './GoogleModule.svelte';

	let googleBusy = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function handleGoogleClick(event: MouseEvent) {
		if (!(event.target instanceof HTMLElement) || !event.target.closest('button')) return;

		if (googleBusy) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		googleBusy = true;
		timer = setTimeout(() => {
			googleBusy = false;
			timer = null;
		}, 5000);
	}

	onDestroy(() => {
		if (timer) clearTimeout(timer);
	});
</script>

<section>
	<p>WORD QUEST</p>
	<h1>나만의 단어 노트를<br />시작해 보세요.</h1>
	<p>예문으로 익히고, 복습으로 오래 기억해요.</p>
	<span
		data-busy={googleBusy || undefined}
		aria-busy={googleBusy}
		onclickcapture={handleGoogleClick}
	>
		<GoogleModule />
	</span>
</section>

<style>
	section {
		width: min(31rem, 100%);
		margin: var(--spacing-20) auto;
		padding-block: var(--spacing-10);
		padding-inline: var(--spacing-12);
		background: var(--yellow);
		box-shadow: 0.8rem 1rem 2rem var(--shadow);
		transform: rotate(-1deg);
	}

	section > p:first-child {
		margin: 0;
		font-weight: 800;
		letter-spacing: 0.12em;
		color: var(--brown);
	}

	h1 {
		margin: var(--spacing-6) 0;
		line-height: 1.18;
	}

	section > p:nth-of-type(2) {
		margin-bottom: var(--spacing-8);
		line-height: 1.65;
		color: var(--ink-soft);
	}

	span[data-busy='true'] {
		cursor: wait;
		opacity: 0.6;
	}

	@media (max-width: 36rem) {
		section {
			margin-block: var(--spacing-10);
			padding-block: var(--spacing-8);
			padding-inline: var(--spacing-8);
		}
	}
</style>
