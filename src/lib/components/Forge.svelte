<script lang="ts">
	import { onDestroy } from 'svelte';

	import ForgeReveal from './ForgeReveal.svelte';
	import ResourceIcon from './ResourceIcon.svelte';

	import { enhance } from '$app/forms';
	import { upgradeChance, upgradeCost, type UpgradeKind } from '$lib/shared/utils/game.util';
	let {
		game,
		form
	}: {
		game: {
			revision: number;
			gold: number;
			iron: number;
			stones: number;
			silver?: number;
			hitGold?: number;
			incomeUpgrades?: number;
			weapon: number;
			attack: number;
			criticalChance: number;
			successRate?: number;
			baseSuccessRate?: number;
			attackUpgrades?: number;
			criticalUpgrades?: number;
		};
		form: { message?: string } | null;
	} = $props();
	let selected = $state<UpgradeKind>('chance');
	let busy = $state(false);
	let phase = $state<'idle' | 'charging' | 'success' | 'failure' | 'error'>('idle');
	let forgingLevel = $state(0);
	let alive = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let finishWait: (() => void) | undefined;
	onDestroy(() => {
		alive = false;
		clearTimeout(timer);
		finishWait?.();
	});
	let outcome = $state<{
		success: boolean;
		attack: number;
		critical: number;
		chance: number;
		income: number;
	} | null>(null);
	const base = $derived(game.baseSuccessRate ?? 10);
	const rate = $derived(game.successRate ?? base);
	const level = $derived(
		selected === 'chance'
			? game.weapon
			: selected === 'attack'
				? (game.attackUpgrades ?? game.weapon)
				: selected === 'critical'
					? (game.criticalUpgrades ?? game.weapon)
					: (game.incomeUpgrades ?? 0)
	);
	const cost = $derived(upgradeCost(level, selected, rate));
	const chance = $derived(upgradeChance(rate));
	const uncharged = $derived(selected !== 'chance' && chance === 0);
	const capped = $derived(
		selected === 'chance' ? chance >= 100 : selected === 'critical' && game.criticalChance >= 100
	);
	const lacking = $derived(
		game.gold < cost.gold ||
			game.iron < cost.iron ||
			game.stones < cost.stones ||
			(game.silver ?? 0) < cost.silver
	);
	const names = { chance: '성공률', attack: '공격력', critical: '치명타', income: '골드 수입' };
</script>

<ForgeReveal
	{phase}
	kind={selected}
	level={phase === 'charging' ? forgingLevel : level}
	{outcome}
	{chance}
	baseChance={base}
	onDismiss={() => {
		phase = 'idle';
	}}
/>

<section aria-label="장비 강화" class="forge" class:working={busy}>
	<div class="resources" aria-label="보유 자원">
		<span aria-label={`골드 ${game.gold}`} title="골드"
			><span aria-hidden="true">🪙</span><b>{game.gold.toLocaleString()}</b></span
		>
		<span aria-label={`철 ${game.iron}`} title="철"
			><ResourceIcon kind="iron" /><b>{game.iron.toLocaleString()}</b></span
		>
		<span aria-label={`은 ${game.silver ?? 0}`} title="은"
			><ResourceIcon kind="silver" /> <b>{(game.silver ?? 0).toLocaleString()}</b></span
		>
		<span aria-label={`강화석 ${game.stones}`} title="강화석"
			><span aria-hidden="true">💎</span><b>{game.stones.toLocaleString()}</b></span
		>
	</div>
	<div class="equipment">
		<div class="weapon" aria-hidden="true">
			<svg viewBox="0 0 100 100" fill="none"
				><path
					d="M47 65 42 30 50 9 58 30 53 65Z"
					fill="#fff7e6"
					stroke="#876039"
					stroke-width="3"
					stroke-linejoin="round"
				/><path d="M50 15v49" stroke="#d6b98d" stroke-width="3" /><path
					d="m31 62 19-5 19 5-3 8-16-4-16 4Z"
					fill="#e0ad54"
					stroke="#876039"
					stroke-width="3"
					stroke-linejoin="round"
				/><path d="M45 68h10v18H45z" fill="#9d673b" stroke="#704b30" stroke-width="3" /><path
					d="m42 87 8-5 8 5-8 7Z"
					fill="#e0ad54"
					stroke="#876039"
					stroke-width="3"
				/></svg
			>
			<span class="level">+{game.weapon}</span>
		</div>
		<div class="weapon-info">
			<span class="eyebrow">장비</span>
			<h2>모험가의 검</h2>
		</div>
	</div>
	<div class="upgrade-options" aria-label="강화 항목">
		{#each ['chance', 'attack', 'income', 'critical'] as const as kind (kind)}
			<button
				type="button"
				class="button secondary"
				class:selected={selected === kind}
				aria-pressed={selected === kind}
				disabled={busy || phase !== 'idle'}
				onclick={() => (selected = kind)}
			>
				<span class="option-icon" aria-hidden="true"
					><ResourceIcon
						kind={{ chance: 'gold', attack: 'iron', income: 'silver', critical: 'stones' }[kind]}
					/></span
				>
				<span class="option-copy"
					><span class="option-name">{names[kind]}</span><strong
						>{kind === 'chance'
							? chance
							: kind === 'attack'
								? game.attack
								: kind === 'income'
									? (game.hitGold ?? 1)
									: game.criticalChance.toFixed(1)}<small
							>{kind === 'chance' || kind === 'critical'
								? '%'
								: kind === 'income'
									? '골드 / 명중'
									: ''}</small
						></strong
					></span
				>
				<span class="selection-dot" aria-hidden="true">{selected === kind ? '✓' : ''}</span>
			</button>
		{/each}
	</div>
	<form
		method="POST"
		use:enhance={({ cancel }) => {
			if (busy || phase !== 'idle' || capped || lacking || uncharged) {
				cancel();
				return;
			}
			if (selected === 'chance') {
				busy = true;
				return async ({ update }) => {
					try {
						await update();
					} finally {
						busy = false;
					}
				};
			}
			const before = {
				weapon: game.weapon,
				attack: game.attack,
				critical: game.criticalChance,
				chance: rate,
				income: game.hitGold ?? 1
			};
			busy = true;
			outcome = null;
			forgingLevel = level;
			phase = 'charging';
			const started = Date.now();
			const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1800;
			return async ({ update, result }) => {
				try {
					await new Promise<void>((resolve) => {
						finishWait = resolve;
						timer = setTimeout(resolve, Math.max(0, duration - (Date.now() - started)));
					});
					if (!alive) return;
					await update();
					if (!alive) return;
					if (result.type === 'success')
						outcome = {
							success: game.weapon > before.weapon || rate > before.chance,
							chance: Math.max(0, rate - before.chance),
							income: (game.hitGold ?? 1) - before.income,
							attack: game.attack - before.attack,
							critical: game.criticalChance - before.critical
						};
					phase = outcome ? (outcome.success ? 'success' : 'failure') : 'error';
				} catch {
					if (alive) phase = 'error';
				} finally {
					busy = false;
				}
			};
		}}
	>
		<input type="hidden" name="kind" value={selected} /><input
			type="hidden"
			name="action"
			value="upgrade"
		/><input type="hidden" name="revision" value={game.revision} />

		<div class="base-chance">
			<span>기본 {base}%</span><span>충전 +{Math.max(0, chance - base)}%p</span><b
				>성공률 {chance}%</b
			>
		</div>
		<div class="chance">
			<span
				>{selected === 'chance' ? '확정 상승' : '성공 확률'}
				<b>{selected === 'chance' ? '100' : chance}%</b></span
			><span
				>{selected === 'chance'
					? `+${Math.min(2, 100 - chance)}~${Math.min(6, 100 - chance)}%p`
					: selected === 'attack'
						? '+2~6'
						: selected === 'income'
							? '+1~3골드/명중'
							: `+${Math.min(0.5, 100 - game.criticalChance).toFixed(1)}~${Math.min(1.5, 100 - game.criticalChance).toFixed(1)}%p`}</span
			>
		</div>
		<button class="button upgrade" disabled={busy || lacking || capped || uncharged}>
			<span class="upgrade-title"
				>{busy
					? '강화 중…'
					: capped
						? '최대치 도달'
						: `${names[selected]} ${selected === 'chance' ? '충전' : '강화'}`}</span
			>
			<span class="cost" aria-label="강화 비용"
				>{#if cost.gold}🪙 {cost.gold}{/if}{#if cost.iron}<ResourceIcon kind="iron" />
					{cost.iron}{/if}{#if cost.silver}<ResourceIcon kind="silver" />
					{cost.silver}{/if}{#if cost.stones}💎
					{cost.stones}{/if}</span
			>
		</button>
		{#if uncharged}<small class="short">골드로 성공률을 먼저 충전해 주세요.</small
			>{:else if lacking && !capped}<small class="short">재료가 부족해요.</small>{/if}
	</form>

	{#if form?.message}<p class="message" role="status">{form.message}</p>{/if}
	<details>
		<summary>강화 안내</summary>
		<p>
			기본 성공률은 단어 레벨 ×10을 버림한 {base}%예요. 골드로 +2~6%p씩 랜덤 충전하고
			공격력·치명타·골드 수입 중 하나에 사용해요. 철은 공격력 +2~6, 강화석은 치명타 +0.5~1.5%p를
			0.1%p 단위로 추첨해요. 은은 명중 골드를 +1~3 올려요. 기본 명중 골드는 1이에요. 성공률과
			치명타는 최대 100%예요.
		</p>
		<p>
			재료는 시도할 때 소모돼요. 실패해도 능력치는 유지되며 성공률은 변하지 않아요. 강화에 성공하면
			공통 성공률은 기본 {base}%로 돌아가요. 골드 비용은 현재 확률과 검 강화 단계가 높을수록
			증가해요.
		</p>
	</details>
</section>

<style>
	.upgrade-options {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
		margin-bottom: 0.9rem;
	}
	.upgrade-options button {
		width: 100%;
		min-height: 86px;
		display: flex;
		align-items: center;
		position: relative;
		gap: 0.6rem;
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: 0.8rem;
		background: var(--paper);
		color: var(--brown);
		text-align: left;
		box-shadow: 0 2px 0 var(--paper-deep);
	}
	.upgrade-options button.selected {
		border-color: var(--brown);
		background: var(--paper-deep);
		box-shadow: inset 0 0 0 1px var(--brown);
	}
	.option-icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--paper-soft);
		font-size: 1.15rem;
	}
	.option-copy {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	.option-name {
		font-size: 0.75rem;
		color: var(--ink-soft);
	}
	.option-copy strong {
		font-size: 1.35rem;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
	}
	.option-copy small {
		font-size: 0.65rem;
		margin-left: 0.2rem;
		font-weight: 400;
	}
	.selection-dot {
		position: absolute;
		right: 0.4rem;
		top: 0.3rem;
		font-size: 0.65rem;
		color: var(--brown);
	}
	.base-chance {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.6rem;
		font-size: 0.72rem;
		color: var(--ink-soft);
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--line);
	}
	.base-chance b {
		margin-left: auto;
		color: var(--brown);
	}
	@media (max-width: 380px) {
		.upgrade-options button {
			padding: 0.65rem 0.5rem;
			gap: 0.4rem;
		}
		.option-icon {
			width: 1.6rem;
			height: 1.6rem;
		}
		.option-copy strong {
			font-size: 1.2rem;
		}
	}

	.short {
		color: var(--red);
		font-size: 0.75rem;
	}

	.forge {
		border: 1px solid var(--line);
		border-radius: 1.2rem;
		background: var(--paper-soft);
		padding: 1.2rem;
	}
	.resources {
		display: flex;
		flex-wrap: wrap;
		gap: 1.2rem;
		padding-bottom: 0.9rem;
		border-bottom: 1px solid var(--line);
		color: var(--ink-soft);
		font-size: 0.85rem;
	}
	.resources > span {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.resources b {
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.equipment {
		display: grid;
		grid-template-columns: 72px minmax(0, 1fr);
		align-items: center;
		gap: 1rem;
		padding: 1.1rem 0;
	}
	.weapon {
		position: relative;
		display: grid;
		place-items: center;
	}
	svg {
		width: 64px;
		height: 84px;
		transform: rotate(20deg);
	}
	.level {
		font-weight: 700;
		color: var(--brown);
		font-size: 0.9rem;
	}
	.eyebrow {
		color: var(--ink-soft);
		font-size: 0.75rem;
	}
	h2 {
		margin: 0.15rem 0 0.6rem;
		font-size: 1.15rem;
	}
	form {
		display: grid;
		gap: 0.6rem;
	}
	.chance {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.3rem;
		font-size: 0.8rem;
		color: var(--ink-soft);
	}
	.chance b {
		color: var(--brown);
	}
	.upgrade {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem;
	}
	.upgrade-title {
		font-weight: 700;
	}
	.cost {
		display: flex;
		gap: 0.6rem;
		font-size: 0.8rem;
	}
	.message {
		font-size: 0.85rem;
	}
	details {
		margin-top: 0.8rem;
		color: var(--ink-soft);
		font-size: 0.8rem;
	}
	summary {
		cursor: pointer;
		width: fit-content;
	}
	p {
		line-height: 1.6;
	}
	.working svg {
		animation: forge 0.4s ease-in-out infinite alternate;
	}
	@keyframes forge {
		to {
			transform: rotate(10deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.working svg {
			animation: none;
		}
	}
</style>
