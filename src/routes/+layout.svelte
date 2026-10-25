<script lang="ts">
	import { onMount } from 'svelte';

	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import { listenForPwaInstall } from '$lib/shared/utils/pwa-install.util';

	let { children } = $props();
	let showNavigationLoading = $state(false);
	const isSignIn = $derived(page.url.pathname === '/signin');

	const links = [
		{ href: '/', label: '모험 기록' },
		{ href: '/quiz', label: '던전 학습' }
	] as const;
	const isAdmin = $derived(page.data.isAdmin === true);

	onMount(listenForPwaInstall);

	beforeNavigate((navigation) => {
		if (!navigator.onLine && navigation.to != null && !navigation.willUnload) {
			navigation.cancel();
			window.location.assign(navigation.to.url);
		}
	});

	$effect(() => {
		if (navigating.to == null) {
			showNavigationLoading = false;
			return;
		}

		const timeout = setTimeout(() => {
			showNavigationLoading = true;
		}, 180);

		return () => clearTimeout(timeout);
	});
</script>

{#if showNavigationLoading}
	<div class="navigation-loading" role="status">
		<span>페이지를 불러오는 중…</span>
	</div>
{/if}

{#if !isSignIn}
	<header class:compact={page.url.pathname === '/quiz' || page.url.pathname === '/'}>
		<a href={resolve('/')} aria-label="워드 노트 홈" data-sveltekit-preload-data="off">
			<strong>wordquest<span aria-hidden="true">.</span></strong>
		</a>
		<nav aria-label="주요 메뉴">
			{#each links as link (link.href)}
				<a
					class="post-it"
					href={resolve(link.href)}
					data-sveltekit-preload-data={link.href === '/' ? 'off' : undefined}
					aria-current={page.url.pathname === link.href ? 'page' : undefined}
				>
					{link.label}
				</a>
			{/each}
			{#if isAdmin}
				<a
					class="post-it admin-link"
					href={resolve('/admin/reports')}
					aria-current={page.url.pathname.startsWith('/admin') ? 'page' : undefined}
				>
					신고 관리
				</a>
			{/if}
		</nav>
	</header>
{/if}

<main
	class:study={page.url.pathname === '/quiz'}
	class:game={!isSignIn}
	data-auth={isSignIn || undefined}
>
	{@render children()}
</main>

<style>
	header.compact {
		padding-top: 1rem;
	}
	main.study {
		min-height: auto;
		padding: 1rem clamp(0.75rem, 3vw, 1.6rem);
	}

	header,
	main {
		width: min(66rem, calc(100% - 2rem));
		margin-inline: auto;
	}

	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: var(--spacing-4);
		padding-top: var(--spacing-10);
	}

	header > a {
		/* border: 0.2rem solid var(--brown); */
		border-radius: 0.5rem;
		padding: var(--spacing-2) var(--spacing-4);
		color: var(--brown);
		background: var(--paper-deep);
		line-height: 1;
		box-shadow: 0.1rem 0.2rem 0.4rem var(--shadow-soft);
		transform: translateY(0.25rem);
	}

	header > a strong {
		font-size: var(--text-2xl);
		letter-spacing: -0.03em;
	}

	header > a strong span {
		color: var(--line-red);
	}

	a {
		text-decoration: none;
	}

	nav {
		display: flex;
		align-items: end;
		gap: var(--spacing-1);
	}

	nav a {
		padding: var(--spacing-2) var(--spacing-4);
		font-weight: 700;
		color: var(--ink);
		background: var(--yellow);
		opacity: 0.72;
		transform: translateY(0.25rem) rotate(-0.6deg);
	}

	nav a:hover {
		opacity: 0.9;
		transform: translateY(0.12rem) rotate(-0.6deg);
	}

	nav a:nth-child(2) {
		transform: translateY(0.25rem) rotate(0.5deg);
	}

	nav a:nth-child(2):hover {
		transform: translateY(0.12rem) rotate(0.5deg);
	}

	nav a:nth-child(3) {
		transform: translateY(0.25rem) rotate(-0.3deg);
	}

	nav a:nth-child(3):hover {
		transform: translateY(0.12rem) rotate(-0.3deg);
	}

	nav a.admin-link {
		background: var(--rose);
		transform: translateY(0.25rem) rotate(0.7deg);
	}

	nav a.admin-link:hover {
		transform: translateY(0.12rem) rotate(0.7deg);
	}

	nav a.admin-link[aria-current='page'] {
		transform: rotate(0.7deg);
	}

	nav a[aria-current='page'] {
		box-shadow: 0 0.3rem 0.8rem var(--shadow);
		opacity: 1;
		transform: rotate(-0.6deg);
	}

	nav a:nth-child(2)[aria-current='page'] {
		transform: rotate(0.5deg);
	}

	nav a:nth-child(3)[aria-current='page'] {
		transform: rotate(-0.3deg);
	}

	main {
		min-height: 42rem;
		padding-block: clamp(var(--spacing-5), 3.5vw, var(--spacing-10));
		padding-inline: clamp(var(--spacing-6), 4.2vw, var(--spacing-12));
		background: var(--paper);
		box-shadow: 0 1.2rem 3rem var(--shadow);
	}

	main[data-auth='true'] {
		padding: 0;
		background: transparent;
		box-shadow: none;
	}

	.navigation-loading {
		position: fixed;
		z-index: 10;
		top: var(--spacing-3);
		left: 50%;
		overflow: hidden;
		border-radius: 0.35rem;
		padding: var(--spacing-2) var(--spacing-4);
		font-size: var(--text-sm);
		font-weight: 700;
		color: var(--brown);
		background: var(--yellow);
		box-shadow: 0 0.2rem 0.5rem var(--shadow);
		transform: translateX(-50%);
	}

	.navigation-loading::after {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 45%;
		height: 0.15rem;
		background: var(--brown);
		content: '';
		animation: loading 0.9s ease-in-out infinite;
	}

	@keyframes loading {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(225%);
		}
	}

	@media (max-width: 42rem) {
		header {
			align-items: stretch;
			flex-direction: column;
			width: stretch;
			padding-top: var(--spacing-4);
		}

		header > a {
			width: fit-content;
			margin-left: var(--spacing-4);
		}

		nav {
			justify-content: stretch;
		}

		nav a {
			flex: 1;
			padding-inline: var(--spacing-2);
			text-align: center;
		}

		main {
			padding-block: var(--spacing-6);
			padding-inline: var(--spacing-4);
			width: stretch;
		}
	}
</style>
