<script lang="ts">
	import { signOut } from '@auth/sveltekit/client';
	import Download from '@lucide/svelte/icons/download';
	import Heart from '@lucide/svelte/icons/heart';
	import { onMount, untrack } from 'svelte';

	import { version } from '../../package.json';

	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Forge from '$lib/components/Forge.svelte';
	import { pwaInstallPrompt, requestPwaInstall } from '$lib/shared/utils/pwa-install.util';

	let { data, form } = $props();
	let showIosInstallOption = $state(false);
	let showIosInstallHelp = $state(false);
	let now = $state(untrack(() => data.game.serverNow));
	const recoverySeconds = $derived(
		data.game.player?.hp === 0
			? Math.max(0, Math.ceil(((data.game.player.recoverAt ?? 0) - now) / 1000))
			: 0
	);

	const summary = $derived(data.summary);
	const weeklyDelta = $derived(
		`${summary.weeklyLevelDelta > 0 ? '+' : ''}${summary.weeklyLevelDelta.toFixed(2)}`
	);
	const notes = $derived([
		{ value: summary.todayStudiedCount, label: '오늘 학습', state: 'due' },
		{ value: summary.learningCount, label: '학습 중', state: 'learning' },
		{ value: summary.memorizedCount, label: '기억한 단어', state: 'memorized' }
	]);

	onMount(() => {
		const recoveryTimer = setInterval(() => (now = Date.now()), 1000);
		const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
		const isIos =
			/iPad|iPhone|iPod/.test(navigator.userAgent) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		const isStandalone =
			navigatorWithStandalone.standalone === true ||
			window.matchMedia('(display-mode: standalone)').matches;
		const refreshWhenVisible = () => {
			if (document.visibilityState === 'visible') void invalidateAll();
		};

		showIosInstallOption = isIos && !isStandalone;
		document.addEventListener('visibilitychange', refreshWhenVisible);

		return () => {
			clearInterval(recoveryTimer);
			document.removeEventListener('visibilitychange', refreshWhenVisible);
		};
	});
</script>

<div class="dashboard">
	<section class="overview" aria-label="학습 현황">
		<header>
			<div>
				<small>나의 어휘 레벨</small>
				<h1>{(Math.floor(data.user.currentLevel * 100) / 100).toFixed(2)}</h1>
			</div>
			<div class="overview-corner">
				<span>최근 7일 {weeklyDelta}</span>
			</div>
		</header>
		<div class="counts">
			{#each notes as note (note.label)}<div>
					<strong>{note.value}</strong><small>{note.label}</small>
				</div>{/each}
		</div>
		<div class="adventure-status" aria-label="탐험 현황">
			<span
				class="health"
				aria-label={`체력 ${data.game.player?.hp ?? 100} / ${data.game.player?.maxHp ?? 100}`}
				title="현재 체력 / 최대 체력"
			>
				<Heart size={19} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
				<strong
					>{data.game.player?.hp ?? 100}<small> / {data.game.player?.maxHp ?? 100}</small></strong
				>
			</span>
			<a
				href={resolve('/quiz')}
				aria-label={`보물상자 ${data.game.battle.chests.length}개 보러가기`}
				title="보물상자"
			>
				<svg class="chest-icon" viewBox="0 0 28 26" fill="none" aria-hidden="true">
					<path d="M3 12V9a6 6 0 0 1 6-6h10a6 6 0 0 1 6 6v3" fill="#d7ab73" />
					<path d="M3 12h22v10H3Z" fill="#bb8655" />
					<path
						d="M3 12V9a6 6 0 0 1 6-6h10a6 6 0 0 1 6 6v13H3V12Zm0 0h22"
						stroke="#795535"
						stroke-width="1.7"
						stroke-linejoin="round"
					/>
					<path d="M8 4v17M20 4v17" stroke="#efd49e" stroke-width="2" />
					<rect x="12" y="10" width="4" height="6" rx="1" fill="#f1d69c" stroke="#8a623b" />
				</svg>
				<strong>{data.game.battle.chests.length}</strong>
			</a>
		</div>
		{#if recoverySeconds > 0}
			<button class="button explore" disabled
				>탈진 · 회복 중 {Math.floor(recoverySeconds / 60)}분 {recoverySeconds % 60}초</button
			>
		{:else}
			<a class="button explore" href={resolve('/quiz')}>던전 학습 →</a>
		{/if}

		<small class="total">누적 {summary.totalReviewCount}개 학습</small>
	</section>
	<Forge game={data.game} {form} />
</div>

<footer>
	<small class="account">{data.user.email}</small>
	{#if $pwaInstallPrompt}
		<button class="button" onclick={requestPwaInstall}>
			<Download aria-hidden="true" />
			앱 설치하기
		</button>
	{:else if showIosInstallOption}
		<button
			class="button"
			onclick={() => (showIosInstallHelp = !showIosInstallHelp)}
			aria-expanded={showIosInstallHelp}
			aria-controls="ios-install-help"
		>
			<Download aria-hidden="true" />
			앱 설치하기
		</button>
	{/if}
	<button class="button secondary" onclick={() => signOut()}>로그아웃</button>
</footer>

{#if showIosInstallHelp}
	<aside id="ios-install-help" class="post-it install-help" aria-labelledby="install-help-title">
		<h2 id="install-help-title">아이폰에 설치하기</h2>
		<ol>
			<li>Safari에서 이 페이지를 열어 주세요.</li>
			<li><strong>공유</strong> 버튼 또는 <strong>더 보기 → 공유</strong>를 누르세요.</li>
			<li><strong>홈 화면에 추가</strong>를 선택하세요.</li>
			<li><strong>웹 앱으로 열기</strong>를 켜고 <strong>추가</strong>를 누르세요.</li>
		</ol>
		<button class="button secondary" onclick={() => (showIosInstallHelp = false)}>닫기</button>
	</aside>
{/if}

<small class="app-version">word-quest v{version}</small>

<style>
	.adventure-status {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
		color: var(--ink-soft);
	}
	.adventure-status > span,
	.adventure-status > a {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2rem;
	}
	.adventure-status .health {
		color: #c46569;
	}
	.adventure-status strong small {
		color: var(--ink-soft);
		font-size: 0.75rem;
		font-weight: 400;
	}
	.chest-icon {
		width: 1.65rem;
		height: 1.5rem;
	}
	.adventure-status strong {
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.adventure-status a {
		color: inherit;
		text-decoration: none;
	}
	.adventure-status a:hover {
		text-decoration: underline;
	}
	.overview-corner {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
	}
	.dashboard {
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		align-items: start;
		gap: 1.2rem;
	}
	.overview {
		padding: 1.2rem;
		border: 1px solid var(--line);
		border-radius: 1.2rem;
		background: var(--paper-soft);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
	}
	header small,
	header span {
		color: var(--ink-soft);
		font-size: 0.8rem;
	}
	h1 {
		margin: 0.2rem 0;
		font-size: 2.6rem;
	}
	.counts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 1rem 0 1.2rem;
		text-align: center;
	}
	.counts > div {
		display: grid;
		gap: 0.2rem;
	}
	.counts strong {
		font-size: 1.4rem;
	}
	.counts small {
		font-size: 0.75rem;
		color: var(--ink-soft);
	}
	.explore {
		display: block;
		width: 100%;
		text-align: center;
		text-decoration: none;
		padding: 0.75rem;
	}
	.total {
		display: block;
		text-align: center;
		margin-top: 0.65rem;
		font-size: 0.75rem;
		color: var(--ink-soft);
	}
	.account {
		margin-right: auto;
		overflow-wrap: anywhere;
		color: var(--ink-soft);
		font-size: 0.75rem;
	}
	footer {
		margin-top: 1.4rem;
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--spacing-3);
	}

	footer :global(svg) {
		width: 1.1em;
		height: 1.1em;
		vertical-align: -0.18em;
	}

	.install-help {
		display: grid;
		gap: var(--spacing-3);
		margin-top: var(--spacing-5);
		padding-block: var(--spacing-4);
		padding-inline: var(--spacing-5);
		background: var(--yellow);
	}

	.install-help :is(h2, ol) {
		margin: 0;
	}

	.install-help ol {
		display: grid;
		gap: var(--spacing-2);
		padding-left: var(--spacing-5);
	}

	.app-version {
		display: block;
		margin-top: var(--spacing-5);
		color: var(--line);
		text-align: right;
	}

	@media (max-width: 48rem) {
		.dashboard {
			grid-template-columns: 1fr;
			gap: 0.9rem;
		}
	}
</style>
