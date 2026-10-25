<script lang="ts">
	let {
		kind = 'attack',
		baseChance = 10,
		phase,
		level,
		outcome,
		chance,
		onDismiss
	}: {
		baseChance?: number;
		kind?: 'chance' | 'attack' | 'critical' | 'income';
		phase: 'idle' | 'charging' | 'success' | 'failure' | 'error';
		level: number;
		outcome: {
			success: boolean;
			attack: number;
			critical: number;
			chance?: number;
			income?: number;
		} | null;
		chance: number;
		onDismiss: () => void;
	} = $props();
	let dialog = $state<HTMLDialogElement>();
	$effect(() => {
		if (!dialog) return;
		if (phase !== 'idle' && !dialog.open) dialog.showModal();
		else if (phase === 'idle' && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	class:charging={phase === 'charging'}
	class:success={phase === 'success'}
	class:failure={phase === 'failure' || phase === 'error'}
	aria-labelledby="forge-reveal-title"
	oncancel={(event) => {
		if (phase === 'charging') event.preventDefault();
		else onDismiss();
	}}
	onclose={onDismiss}
>
	<div class="stage">
		<div class="aura" aria-hidden="true"></div>
		<div class="orbit" aria-hidden="true"></div>
		<div class="particles" aria-hidden="true">
			{#each Array.from({ length: 20 }) as _, i (i)}<i
					style={`--angle:${i * 18}deg;--delay:${(i % 5) * 90}ms`}
				></i>{/each}
		</div>
		<div class="sword" aria-hidden="true">
			<svg viewBox="0 0 100 100" fill="none"
				><path
					d="M47 65 42 30 50 9 58 30 53 65Z"
					fill="#fff9e9"
					stroke="#a7783c"
					stroke-width="2"
				/><path d="M50 15v49" stroke="#e4c891" stroke-width="2" /><path
					d="m31 62 19-5 19 5-3 8-16-4-16 4Z"
					fill="#efc36e"
					stroke="#a7783c"
					stroke-width="2"
				/><path d="M45 68h10v18H45z" fill="#9d673b" stroke="#704b30" stroke-width="2" /><path
					d="m42 87 8-5 8 5-8 7Z"
					fill="#efc36e"
					stroke="#a7783c"
					stroke-width="2"
				/></svg
			>
		</div>
		<div class="copy" aria-live="polite" aria-atomic="true">
			<span class="level"
				>{kind === 'chance'
					? '성공률 충전'
					: kind === 'critical'
						? '치명타 강화'
						: kind === 'income'
							? '골드 수입 강화'
							: '공격력 강화'} · +{level}</span
			>
			<h2 id="forge-reveal-title">
				{phase === 'charging'
					? '힘을 모으고 있어요…'
					: phase === 'success'
						? kind === 'chance'
							? '성공률 충전 완료!'
							: '강화 성공!'
						: phase === 'failure'
							? '아직, 한 번의 기회가 더'
							: '결과를 확인하지 못했어요'}
			</h2>
			{#if phase === 'charging'}<p class="hint">두근두근…</p>
			{:else if phase === 'success' && outcome}<div class="gains">
					{#if outcome.attack}<span>⚔ 공격력 <b>+{outcome.attack}</b></span>{/if}
					{#if outcome.critical}<span>✦ 치명타 <b>+{outcome.critical.toFixed(1)}%p</b></span>{/if}
					{#if outcome.income}<span>명중 골드 <b>+{outcome.income}</b></span>{/if}
					{#if outcome.chance}<span>강화 성공률 <b>+{outcome.chance}%p</b></span>{/if}
				</div>
				{#if kind !== 'chance'}<p>다음 강화는 기본 성공률 {baseChance}%부터 시작해요.</p>{/if}
			{:else if phase === 'failure'}<p>능력치 유지 · 성공 확률 <b>{chance}%</b></p>
			{:else if phase === 'error'}<p>화면으로 돌아가 저장된 결과를 확인해 주세요.</p>{/if}
		</div>
		{#if phase !== 'charging' && phase !== 'idle'}<button
				type="button"
				class="return"
				onclick={onDismiss}>{phase === 'success' ? '좋아, 더 강해졌어!' : '돌아가기'}</button
			>{/if}
	</div>
</dialog>

<style>
	dialog {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		border: 0;
		overflow: auto;
		color: var(--ink);
		background: radial-gradient(ellipse at 50% 38%, #fff5d8, #ecd0a8 72%);
	}
	dialog::backdrop {
		background: #302218b0;
		backdrop-filter: blur(8px);
	}
	.stage {
		position: relative;
		min-height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: max(2rem, env(safe-area-inset-top)) 1rem max(2rem, env(safe-area-inset-bottom));
		overflow: hidden;
		isolation: isolate;
	}
	.sword {
		width: clamp(140px, 27vh, 260px);
		height: clamp(140px, 27vh, 260px);
		z-index: 1;
		filter: drop-shadow(0 0 18px #e3b36660);
	}
	svg {
		width: 100%;
		height: 100%;
		transform: rotate(18deg);
	}
	.aura {
		position: absolute;
		z-index: -1;
		top: 37%;
		left: 50%;
		width: min(80vw, 550px);
		aspect-ratio: 1;
		border-radius: 50%;
		background: radial-gradient(circle, #f9d88a70, #e3af4c15 55%, transparent 70%);
		transform: translate(-50%, -50%);
	}
	.orbit {
		position: absolute;
		top: 37%;
		left: 50%;
		width: min(60vw, 330px);
		aspect-ratio: 1;
		border: 1px solid #f5cd7960;
		outline: 1px solid #f5cd7925;
		outline-offset: 18px;
		border-radius: 50%;
		transform: translate(-50%, -50%);
	}
	.copy {
		position: relative;
		text-align: center;
		z-index: 1;
		max-width: 34rem;
	}
	.level {
		display: inline-block;
		margin-top: 0.6rem;
		color: #895820;
		font:
			800 2.4rem/1.3 system-ui,
			sans-serif;
	}
	h2 {
		font-size: clamp(1.3rem, 4vw, 2rem);
		margin: 0.55rem 0;
		text-wrap: balance;
	}
	p {
		font-size: 1rem;
		line-height: 1.6;
		color: var(--ink-soft);
	}
	.gains {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1rem 2rem;
		margin: 1rem 0;
	}
	.gains span {
		display: grid;
		gap: 0.4rem;
		font-size: 0.95rem;
		animation: gain 0.55s 0.15s both;
	}
	.gains span:nth-child(2) {
		animation-delay: 0.45s;
	}
	.gains b {
		font:
			800 2rem system-ui,
			sans-serif;
		color: #895820;
	}
	.return {
		z-index: 1;
		margin-top: 1.5rem;
		padding: 0.75rem 1.6rem;
		border: 1px solid #e8bd71;
		border-radius: 2rem;
		color: #51351d;
		background: #f2d49c;
		font-weight: 800;
		box-shadow: 0 4px 0 #9c733e;
		animation: gain 0.4s 0.6s both;
	}
	.return:focus-visible {
		outline: 3px solid #fff8df;
		outline-offset: 5px;
	}
	.particles {
		position: absolute;
		pointer-events: none;
		top: 37%;
		left: 50%;
	}
	.particles i {
		position: absolute;
		width: 5px;
		height: 9px;
		border-radius: 50%;
		background: #ffdc83;
		opacity: 0;
	}
	.charging .particles i {
		animation: gather 1.2s var(--delay) infinite;
	}
	.charging .sword {
		animation: summon 1.8s ease-in-out both;
	}
	.charging .aura {
		animation: charge 1.8s ease-in-out both;
	}
	.charging .orbit {
		animation: ring 1.8s ease-in-out both;
	}
	.charging .hint {
		animation: breathe 0.8s infinite alternate;
	}
	.success .sword {
		animation: strike 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}
	.success .aura {
		animation: bloom 0.8s ease-out both;
	}
	.success .orbit {
		animation: shock 0.8s ease-out both;
	}
	.success .particles i {
		animation: burst 0.9s var(--delay) both;
	}
	.failure .sword {
		animation: fizzle 0.7s both;
	}
	.failure .orbit,
	.failure .aura {
		opacity: 0.2;
		transition: opacity 0.7s;
	}
	@keyframes gather {
		from {
			opacity: 0;
			transform: rotate(var(--angle)) translateY(-250px);
		}
		30% {
			opacity: 0.9;
		}
		to {
			opacity: 0;
			transform: rotate(var(--angle)) translateY(-35px);
		}
	}
	@keyframes summon {
		0% {
			transform: translateY(25px) scale(0.8);
			opacity: 0.5;
		}
		65% {
			transform: translateY(-12px) scale(1.05);
			filter: drop-shadow(0 0 28px #ffdf8d);
		}
		85% {
			transform: translate(-3px, -12px) scale(1.08);
		}
		95% {
			transform: translate(3px, -12px) scale(1.08);
		}
		100% {
			transform: translateY(-12px) scale(1.08);
		}
	}
	@keyframes charge {
		to {
			transform: translate(-50%, -50%) scale(1.3);
			opacity: 1;
		}
	}
	@keyframes ring {
		from {
			transform: translate(-50%, -50%) scale(1.3);
			opacity: 0.2;
		}
		to {
			transform: translate(-50%, -50%) scale(0.6);
			opacity: 1;
		}
	}
	@keyframes strike {
		0% {
			transform: scale(1.08) translateY(-12px);
		}
		30% {
			transform: scale(1.3);
			filter: drop-shadow(0 0 40px #ffe0a0);
		}
		65% {
			transform: scale(0.97);
		}
		to {
			transform: scale(1);
		}
	}
	@keyframes bloom {
		from {
			transform: translate(-50%, -50%) scale(0.5);
			opacity: 1;
		}
		to {
			transform: translate(-50%, -50%) scale(1.7);
			opacity: 0.7;
		}
	}
	@keyframes shock {
		from {
			transform: translate(-50%, -50%) scale(0.5);
			opacity: 1;
		}
		to {
			transform: translate(-50%, -50%) scale(2.3);
			opacity: 0;
		}
	}
	@keyframes burst {
		from {
			opacity: 1;
			transform: rotate(var(--angle)) translateY(-20px);
		}
		to {
			opacity: 0;
			transform: rotate(var(--angle)) translateY(-280px) rotate(90deg);
		}
	}
	@keyframes fizzle {
		25% {
			transform: rotate(-8deg);
		}
		50% {
			transform: rotate(6deg);
		}
		to {
			transform: translateY(8px);
			filter: saturate(0.4);
		}
	}
	@keyframes gain {
		from {
			opacity: 0;
			transform: translateY(14px) scale(0.9);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes breathe {
		to {
			opacity: 0.5;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		*,
		*::before,
		*::after {
			animation: none !important;
			transition: none !important;
		}
		.particles {
			display: none;
		}
	}
</style>
