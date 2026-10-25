<script lang="ts">
	import { onDestroy } from 'svelte';
	import Swords from '@lucide/svelte/icons/swords';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Sparkles from '@lucide/svelte/icons/sparkles';

	import DungeonMonster from '$lib/components/DungeonMonster.svelte';

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

<svelte:head>
	<title>Word Quest · 단어를 익히고, 던전을 탐험하세요</title>
	<meta
		name="description"
		content="예문으로 단어를 익히고 몬스터를 물리치세요. 보물상자를 모으고 무기를 강화하며 나만의 어휘 모험을 이어가세요."
	/>
</svelte:head>

<div class="welcome">
	<header class="brand">
		<span class="brand-mark"><Swords size={22} strokeWidth={1.6} /></span>
		<strong>wordquest<span>.</span></strong>
		<small>단어로 떠나는 모험</small>
	</header>

	<section class="entry" aria-labelledby="welcome-title">
		<div class="invitation">
			<p class="eyebrow"><span></span> 오늘의 모험이 기다리고 있어요</p>
			<h1 id="welcome-title">한 단어씩,<br />더 멀리 떠나는 모험.</h1>
			<p class="intro">
				예문 속 단어를 맞히면 몬스터에게 한 방!<br />쌓이는 어휘만큼, 당신의 모험도 강해져요.
			</p>
			<div class="login">
				<div
					data-busy={googleBusy || undefined}
					aria-busy={googleBusy}
					onclickcapture={handleGoogleClick}
				>
					<GoogleModule />
				</div>
				<p class="login-note" role="status">
					{googleBusy ? '모험을 준비하고 있어요…' : 'Google 계정으로 나의 모험을 시작하세요.'}
				</p>
			</div>
		</div>

		<div class="scene" aria-hidden="true">
			<div class="scene-caption"><span>첫 번째 조우</span><small>THE ADVENTURE BEGINS</small></div>
			<div class="arch">
				<div class="arch-inner"></div>
				<span class="star star-one">✦</span><span class="star star-two">✧</span>
			</div>
			<div class="floor"></div>
			<div class="monster"><DungeonMonster kind="slime" /></div>
			<div class="word-card">
				<small>오늘의 단어</small><strong>adventure</strong><span>모험, 새로운 경험</span>
				<div class="word-line"></div>
			</div>
			<svg class="treasure" viewBox="0 0 72 62" fill="none">
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
				<path d="m62 6 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#c69a53" />
			</svg>
			<div class="scene-note">작은 정답 하나가, 다음 모험의 열쇠.</div>
		</div>
	</section>

	<ol class="journey" aria-label="모험을 즐기는 방법">
		<li>
			<span class="step-icon"><BookOpen size={20} strokeWidth={1.6} /></span>
			<div>
				<strong>단어를 익히고</strong>
				<p>예문으로 배우고, 복습으로 기억해요.</p>
			</div>
		</li>
		<li>
			<span class="step-icon"><Swords size={20} strokeWidth={1.6} /></span>
			<div>
				<strong>몬스터를 물리치고</strong>
				<p>정답을 맞히며 던전을 탐험해요.</p>
			</div>
		</li>
		<li>
			<span class="step-icon"><Sparkles size={20} strokeWidth={1.6} /></span>
			<div>
				<strong>더 강해지는 나</strong>
				<p>보물을 모아 나만의 무기를 강화해요.</p>
			</div>
		</li>
	</ol>
	<footer>오늘 배운 단어가 내일의 힘이 되도록.</footer>
</div>

<style>
	.welcome {
		max-width: 60rem;
		margin: 0 auto;
		padding: clamp(1.5rem, 5vw, 3rem) 0 1.5rem;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 1.75rem;
	}
	.brand-mark {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 1px solid var(--line);
		border-radius: 0.8rem;
		background: var(--paper);
		color: var(--brown);
	}
	.brand strong {
		font-size: 1.5rem;
		letter-spacing: -0.06em;
	}
	.brand strong span {
		color: #b38c50;
	}
	.brand > small {
		margin-left: auto;
		color: var(--ink-soft);
		font-size: 0.75rem;
	}
	.entry {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 1.6rem;
		background: var(--paper);
		box-shadow: 0 1rem 3rem var(--shadow-soft);
	}
	.invitation {
		align-self: center;
		padding: 3rem 0 3rem 2.5rem;
		position: relative;
		z-index: 1;
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 1.4rem;
		font-size: 0.75rem;
		color: var(--brown);
	}
	.eyebrow span {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: var(--green-strong);
	}
	h1 {
		margin: 0;
		font-size: clamp(2rem, 3.5vw, 2.8rem);
		line-height: 1.3;
		letter-spacing: -0.055em;
	}
	.intro {
		margin: 1.2rem 0 2rem;
		color: var(--ink-soft);
		font-size: 0.9rem;
		line-height: 1.85;
	}
	.login {
		width: fit-content;
		max-width: 100%;
	}
	.login :global(.gsi-material-button) {
		height: 3rem;
		width: 100%;
		min-width: 15rem;
		border-color: var(--line);
		border-radius: 0.65rem;
		padding-inline: 1.25rem;
	}
	.login-note {
		min-height: 1.1rem;
		margin: 0.7rem 0 0;
		font-size: 0.7rem;
		color: var(--ink-soft);
		text-align: center;
	}
	[data-busy='true'] {
		cursor: wait;
		opacity: 0.6;
	}
	.scene {
		position: relative;
		min-height: 27rem;
		overflow: hidden;
		background: radial-gradient(
			ellipse at 55% 48%,
			#f0dfb9 0,
			var(--paper-soft) 62%,
			var(--paper) 100%
		);
	}
	.scene-caption {
		position: absolute;
		top: 2.25rem;
		left: 0;
		right: 0;
		text-align: center;
		display: grid;
		gap: 0.3rem;
		color: var(--brown);
	}
	.scene-caption span {
		font-size: 0.85rem;
	}
	.scene-caption small {
		font-size: 0.5rem;
		letter-spacing: 0.2em;
		opacity: 0.65;
	}
	.arch {
		position: absolute;
		width: 11.8rem;
		height: 16rem;
		top: 5.3rem;
		left: 50%;
		transform: translateX(-50%);
		border: 1.2rem solid #d1bb98;
		border-bottom: 0;
		border-radius: 7rem 7rem 0 0;
		background: #665545;
		box-shadow:
			0 0 0 1px #b29b79,
			inset 0 0 2rem #42392f;
	}
	.arch::before,
	.arch::after {
		content: '';
		position: absolute;
		top: 7rem;
		width: 1.65rem;
		height: 0.7rem;
		border: 1px solid #b29b79;
		background: #dac9ad;
	}
	.arch::before {
		left: -1.4rem;
	}
	.arch::after {
		right: -1.4rem;
	}
	.arch-inner {
		position: absolute;
		inset: 0;
		background: radial-gradient(ellipse at 50% 100%, #beaa77 0, transparent 65%);
	}
	.star {
		position: absolute;
		color: #ecd29b;
	}
	.star-one {
		top: 4.5rem;
		left: 1rem;
		font-size: 1.3rem;
	}
	.star-two {
		top: 2.8rem;
		right: 1rem;
		font-size: 0.8rem;
	}
	.floor {
		position: absolute;
		width: 19rem;
		height: 4rem;
		background: #cfbc99;
		border-radius: 50%;
		top: 19.5rem;
		left: 50%;
		transform: translateX(-50%);
		opacity: 0.3;
	}
	.monster {
		position: absolute;
		width: 10rem;
		height: 9.2rem;
		top: 12.5rem;
		left: 50%;
		transform: translateX(-40%);
	}
	.word-card {
		position: absolute;
		top: 9rem;
		left: 0.2rem;
		width: 8.7rem;
		padding: 1rem;
		border: 1px solid #cfb88c;
		border-radius: 0.55rem;
		background: #fff9e9;
		box-shadow: 0 0.5rem 1rem var(--shadow);
		transform: rotate(-9deg);
		display: grid;
		gap: 0.45rem;
	}
	.word-card small {
		font-size: 0.6rem;
		color: var(--ink-soft);
	}
	.word-card strong {
		font-size: 1.15rem;
	}
	.word-card span {
		font-size: 0.65rem;
		color: var(--ink-soft);
	}
	.word-line {
		width: 65%;
		border-top: 2px solid #e4d5b7;
		margin-top: 0.2rem;
	}
	.treasure {
		position: absolute;
		top: 18.3rem;
		right: 1.1rem;
		width: 5.7rem;
		height: 5rem;
		transform: rotate(7deg);
	}
	.scene-note {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 1.25rem;
		text-align: center;
		color: var(--ink-soft);
		font-size: 0.7rem;
	}
	.journey {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.5rem;
		margin: 1.5rem 0 0;
		padding: 1.4rem 1.5rem;
		list-style: none;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 1rem;
	}
	.journey li {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
	}
	.step-icon {
		flex-shrink: 0;
		display: grid;
		place-items: center;
		width: 2.3rem;
		height: 2.3rem;
		border-radius: 0.7rem;
		background: var(--paper-deep);
		color: var(--brown);
	}
	.journey strong {
		font-size: 0.85rem;
	}
	.journey p {
		margin: 0.3rem 0 0;
		font-size: 0.7rem;
		color: var(--ink-soft);
		line-height: 1.6;
	}
	footer {
		padding: 1.5rem 0 0;
		text-align: center;
		color: var(--ink-soft);
		font-size: 0.7rem;
	}
	@media (max-width: 48rem) {
		.invitation {
			padding-left: 1.75rem;
		}
		.word-card {
			left: 0;
			width: 7.4rem;
			padding: 0.8rem;
		}
		.treasure {
			right: 0.5rem;
		}
		.journey {
			gap: 0.75rem;
			padding: 1.2rem;
		}
		.journey li {
			flex-direction: column;
		}
	}
	@media (max-width: 36rem) {
		.welcome {
			padding-top: 1.25rem;
		}
		.brand {
			margin-bottom: 1rem;
		}
		.brand > small {
			font-size: 0.65rem;
		}
		.entry {
			grid-template-columns: 1fr;
			border-radius: 1.2rem;
		}
		.invitation {
			padding: 2rem 1.5rem 1rem;
			text-align: center;
		}
		.eyebrow {
			justify-content: center;
			margin-bottom: 1rem;
		}
		h1 {
			font-size: 2.25rem;
		}
		.intro {
			font-size: 0.85rem;
			margin: 1rem 0 1.5rem;
		}
		.login {
			margin: 0 auto;
		}
		.scene {
			min-height: 20rem;
		}
		.scene-caption {
			display: none;
		}
		.arch {
			top: 1rem;
			height: 15rem;
			width: 11rem;
		}
		.floor {
			top: 14.5rem;
		}
		.monster {
			top: 8rem;
			width: 9rem;
			height: 8.3rem;
		}
		.word-card {
			top: 4rem;
			left: calc(50% - 10rem);
			width: 8rem;
		}
		.treasure {
			top: 13rem;
			right: calc(50% - 10rem);
		}
		.scene-note {
			bottom: 0.8rem;
		}
		.journey {
			grid-template-columns: 1fr;
			gap: 1rem;
			margin-top: 1rem;
		}
		.journey li {
			flex-direction: row;
			align-items: center;
		}
		.journey p {
			margin-top: 0.1rem;
		}
	}
</style>
