<script lang="ts">
	import { untrack } from 'svelte';

	import DungeonMonster from './DungeonMonster.svelte';

	import type { BattleView, StudyReward } from '$lib/shared/types/journey.type';
	import { MONSTER_NAMES } from '$lib/shared/utils/game.util';
	let {
		battle,
		reward,
		eventId
	}: {
		battle: BattleView;
		reward?: StudyReward & { healing?: number; playerDamage?: number };
		eventId: number;
	} = $props();
	let shown = $state(untrack(() => ({ ...battle })));
	let defeated = $state(false);
	const percent = $derived(Math.max(0, Math.min(100, (shown.hp / shown.maxHp) * 100)));
	$effect(() => {
		const next = battle;
		const hit = reward;
		const previous = untrack(() => shown);
		if (
			hit?.clear &&
			next.kills > previous.kills &&
			!window.matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			shown = { ...previous, hp: 0 };
			defeated = true;
			const timer = setTimeout(() => {
				shown = { ...next };
				defeated = false;
			}, 850);
			return () => clearTimeout(timer);
		}
		shown = { ...next };
		defeated = false;
	});
</script>

<div class="arena" class:boss={shown.boss}>
	<div class="monster-heading">
		<div class="level-badge">Lv.{shown.level ?? 10}</div>
		<div class="monster-title">
			{#if shown.boss}<span class="rank">♛ BOSS</span>{/if}
			<h2>{MONSTER_NAMES[shown.kind ?? (shown.boss ? 'guardian' : 'slime')]}</h2>
		</div>
	</div>
	{#key eventId}
		<div
			class="impact-stage"
			class:critical={!!reward?.critical}
			class:hit={!!reward?.damage}
			class:healing={!!reward?.healing}
			class:attacking={!!reward?.playerDamage}
		>
			<div class="monster" class:defeated>
				<DungeonMonster boss={shown.boss} kind={shown.kind} />
			</div>
			{#if reward?.damage}
				<div class="fx" aria-hidden="true">
					<i class="cut"></i>{#if reward.critical}<i class="cut cross"></i>{/if}<i class="ring"
					></i>{#each Array.from({ length: 8 }) as _, i (i)}<i
							class="spark"
							style={`--a:${i * 45}deg`}
						></i>{/each}
				</div>
				<b class="damage" aria-hidden="true"
					>{#if reward.critical}<small>CRITICAL</small>{/if}−{reward.damage}</b
				>
			{:else if reward?.healing}<b class="heal" aria-hidden="true">+{reward.healing}</b>{/if}
		</div>
	{/key}
	<div class="health" class:low={shown.hp > 0 && percent <= 25} class:empty={shown.hp === 0}>
		<div class="hp-label">
			<span class="hp-state"
				>{defeated ? '격파 완료' : percent <= 25 ? '체력 위험' : '몬스터 체력'}</span
			><span><b>{shown.hp.toLocaleString()}</b> / {shown.maxHp.toLocaleString()}</span>
		</div>
		<div
			class="track"
			role="progressbar"
			aria-label="몬스터 체력"
			aria-valuenow={shown.hp}
			aria-valuemin={0}
			aria-valuemax={shown.maxHp}
		>
			<span class="trail" style={`width:${percent}%`}></span><span
				class="fill"
				style={`width:${percent}%`}
			></span><span class="ticks"></span>
			{#key eventId}{#if reward?.damage}<span class="bar-impact"></span>{/if}{/key}
		</div>
	</div>
</div>

<style>
	.attacking .monster {
		animation: monster-attack 0.5s ease-in-out;
	}
	@keyframes monster-attack {
		20% {
			transform: translateY(-8px) scale(0.9);
		}
		55% {
			transform: translateY(22px) scale(1.22);
		}
		100% {
			transform: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.attacking .monster {
			animation: none;
		}
	}

	.arena {
		--hp-color: #687b43;
		display: grid;
		grid-template-columns: 112px minmax(0, 1fr);
		grid-template-rows: 1fr 1fr;
		align-items: center;
		column-gap: 0.65rem;
		padding: 0.4rem 0.65rem;
		border: 1px solid var(--line);
		border-radius: 1rem;
		background: linear-gradient(145deg, var(--paper-soft), var(--paper-deep));
		box-shadow:
			inset 0 1px 0 #ffffff80,
			0 3px 0 var(--paper-deep);
	}
	.arena.boss {
		--hp-color: #a44d37;
		border-color: #b77853;
		background: linear-gradient(145deg, var(--paper-soft), #ead2b6);
	}
	.monster-heading {
		grid-column: 2;
		grid-row: 1;
		align-self: end;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding-bottom: 0.25rem;
	}
	.level-badge {
		flex-shrink: 0;
		padding: 0.2rem 0.35rem;
		border: 1px solid #ffffff45;
		border-radius: 0.65rem;
		background: var(--brown);
		color: var(--paper);
		font-size: 0.7rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.monster-title {
		min-width: 0;
	}
	.rank {
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--ink-soft);
	}
	h2 {
		margin: 0;
		font-size: 0.95rem;
		color: var(--brown);
		letter-spacing: -0.04em;
	}
	.boss .rank {
		color: #98452f;
	}
	.hp-state {
		font-size: 0.65rem;
		font-weight: 700;
	}
	.impact-stage {
		grid-column: 1;
		grid-row: 1 / 3;
		position: relative;
		width: 112px;
		height: 112px;
		display: grid;
		place-items: center;
		isolation: isolate;
	}
	.monster {
		width: 112px;
		height: 102px;
		transform-origin: 50% 85%;
	}
	.fx {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 2;
	}
	.cut {
		position: absolute;
		top: 40%;
		left: 3%;
		width: 140px;
		height: 9px;
		border-radius: 100%;
		background: #fff5cf;
		border-bottom: 3px solid #c58a37;
		box-shadow: 0 0 12px #ecc275;
		transform: rotate(-35deg);
		animation: slash 0.36s both;
	}
	.cross {
		rotate: 75deg;
		animation-delay: 0.07s;
	}
	.ring {
		position: absolute;
		inset: 12px 30px;
		border: 3px solid #d59a40;
		border-radius: 50%;
		animation: ripple 0.5s both;
	}
	.spark {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 5px;
		height: 10px;
		border-radius: 3px;
		background: #d6a34f;
		animation: sparks 0.5s both;
	}
	.damage,
	.heal {
		position: absolute;
		z-index: 3;
		left: 60%;
		top: 12%;
		color: #9c5228;
		font:
			900 1.5rem/1.1 system-ui,
			sans-serif;
		text-shadow:
			0 2px #fff6dd,
			1px 0 #fff6dd;
		pointer-events: none;
		animation: damage 0.95s both;
		white-space: nowrap;
	}
	.damage small {
		display: block;
		font-size: 0.65rem;
		letter-spacing: 0.08em;
		margin-bottom: 0.2rem;
	}
	.heal {
		color: #8a713f;
	}
	.hit .monster {
		animation: recoil 0.48s both;
	}
	.critical .monster {
		animation: heavy-recoil 0.6s both;
	}
	.critical .damage {
		color: #a66c12;
		font-size: 2rem;
	}
	.critical .cut {
		height: 13px;
		box-shadow: 0 0 20px #e9b54f;
	}
	.critical .ring {
		border-width: 5px;
	}
	.hit .monster.defeated {
		animation: defeat 0.8s both;
	}
	.healing .monster {
		animation: recover 0.6s both;
	}
	.health {
		grid-column: 2;
		grid-row: 2;
		align-self: start;
		width: 100%;
	}
	.hp-label {
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.4rem;
		justify-content: space-between;
		align-items: center;
		font-size: 0.75rem;
		color: var(--ink-soft);
		margin: 0 0.1rem 0.25rem;
		font-variant-numeric: tabular-nums;
	}
	.hp-label b {
		color: var(--brown);
		font-size: 0.85rem;
	}
	.track {
		position: relative;
		height: 18px;
		overflow: hidden;
		border: 1px solid #ba9870;
		border-radius: 8px;
		background: #d8c2a4;
		box-shadow: inset 0 2px 3px #65472b30;
	}
	.fill,
	.trail {
		position: absolute;
		left: 0;
		top: 0;
		height: 100%;
		border-radius: 6px;
	}
	.trail {
		background: #e8b66d;
		transition: width 0.6s 0.22s ease-out;
	}
	.fill {
		background: linear-gradient(180deg, #ffffff35, #00000015), var(--hp-color);
		box-shadow: inset 0 2px 0 #ffffff40;

		transition: width 0.18s ease-out;
	}
	.ticks {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			90deg,
			transparent 0 calc(25% - 1px),
			#fff5db35 calc(25% - 1px) 25%
		);
	}
	.bar-impact {
		position: absolute;
		inset: 0;
		background: #fff1bb;
		animation: bar-hit 0.35s both;
	}
	.low .fill {
		background: linear-gradient(#c67b46, #9c4e2c);
	}
	.low .track {
		border-color: #a96c41;
	}
	.empty .hp-label {
		color: var(--brown);
	}
	@media (max-width: 400px) {
		.arena {
			grid-template-columns: 88px minmax(0, 1fr);
		}
		.impact-stage {
			width: 88px;
			height: 100px;
		}
		.monster {
			width: 88px;
			height: 88px;
		}
		.monster-heading {
			flex-wrap: wrap;
			gap: 0.2rem 0.35rem;
		}
	}
	@keyframes slash {
		0% {
			opacity: 0;
			transform: rotate(-35deg) translateX(-45px) scaleX(0.2);
		}
		30% {
			opacity: 1;
			transform: rotate(-35deg) scaleX(1.1);
		}
		100% {
			opacity: 0;
			transform: rotate(-35deg) translateX(30px) scaleX(1.2);
		}
	}
	@keyframes recoil {
		0% {
			transform: none;
		}
		16%,
		25% {
			transform: translate(9px, 2px) rotate(9deg) scale(0.9, 1.05);
			filter: brightness(1.25);
		}
		50% {
			transform: translateX(-5px) scale(1.08, 0.92);
		}
		75% {
			transform: translateX(2px);
		}
		100% {
			transform: none;
		}
	}
	@keyframes heavy-recoil {
		12%,
		25% {
			transform: translate(14px, -4px) rotate(15deg) scale(0.82, 1.12);
			filter: brightness(1.4);
		}
		48% {
			transform: translate(-9px, 3px) rotate(-8deg) scale(1.15, 0.85);
		}
		72% {
			transform: translateX(4px) rotate(3deg);
		}
		100% {
			transform: none;
		}
	}
	@keyframes ripple {
		from {
			opacity: 0.8;
			transform: scale(0.3);
		}
		to {
			opacity: 0;
			transform: scale(1.65);
		}
	}
	@keyframes sparks {
		from {
			opacity: 1;
			transform: rotate(var(--a)) translateY(-15px);
		}
		to {
			opacity: 0;
			transform: rotate(var(--a)) translateY(-80px) scale(0.4);
		}
	}
	@keyframes damage {
		0% {
			opacity: 0;
			transform: translateY(10px) scale(0.6);
		}
		20% {
			opacity: 1;
			transform: translateY(-8px) scale(1.25);
		}
		55% {
			opacity: 1;
			transform: translateY(-16px) scale(1);
		}
		100% {
			opacity: 0;
			transform: translateY(-40px) scale(0.9);
		}
	}
	@keyframes defeat {
		20% {
			transform: scale(1.18, 0.85);
			filter: brightness(1.4);
		}
		65%,
		100% {
			transform: translateY(-15px) scale(0.1);
			opacity: 0;
		}
	}
	@keyframes recover {
		50% {
			filter: drop-shadow(0 0 10px #d9bb78);
			transform: scale(1.05);
		}
	}
	@keyframes bar-hit {
		from {
			opacity: 0.65;
		}
		to {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		*,
		*::before,
		*::after {
			animation: none !important;
			transition: none !important;
		}
		.fx,
		.bar-impact {
			display: none;
		}
		.damage,
		.heal {
			font-size: 1rem;
			top: 0;
		}
		.critical .damage {
			font-size: 1.2rem;
		}
	}
</style>
