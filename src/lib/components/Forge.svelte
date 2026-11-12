<script lang="ts">
	import { onDestroy } from 'svelte';

	import ForgeReveal from './ForgeReveal.svelte';
	import ResourceIcon from './ResourceIcon.svelte';

	import type { ArmorStats } from '$lib/shared/types/combat.type';
	import type { GameEffect } from '$lib/shared/types/game-effect.type';
	import type { SubmitFunction } from '@sveltejs/kit';

	import { enhance } from '$app/forms';
	import {
		COMBO_RATE_CAP,
		COMBAT_PERCENT_CAP,
		RESOURCE_YIELD_KINDS,
		RESOURCE_YIELD_NAMES,
		RESOURCE_YIELD_UPGRADE_COST,
		UPGRADE_GAINS,
		availableUpgradeLimit,
		rebirthCost,
		successfulUpgradeLimit,
		upgradeChance,
		upgradeCost,
		vocabularyUpgradeLimit,
		type ResourceYieldKind,
		type UpgradeKind
	} from '$lib/shared/utils/game.util';
	const UPGRADE_DISPLAY: Record<
		UpgradeKind,
		{ name: string; resource: ResourceYieldKind; unit: string; cap?: number }
	> = {
		chance: { name: '성공률', resource: 'gold', unit: '%', cap: 100 },
		attack: { name: '공격력', resource: 'iron', unit: '' },
		combo: { name: '연계', resource: 'stones', unit: '%', cap: COMBO_RATE_CAP },
		income: { name: '골드 수입', resource: 'silver', unit: '골드 / 명중' },
		maxHp: { name: '최대 체력', resource: 'iron', unit: 'HP' },
		killRecovery: { name: '처치 회복', resource: 'silver', unit: 'HP / 처치' },
		defense: { name: '방어력', resource: 'stones', unit: '%', cap: COMBAT_PERCENT_CAP }
	};
	type ForgeGame = {
		revision: number;
		gold: number;
		iron: number;
		stones: number;
		silver?: number;
		hitGold?: number;
		incomeUpgrades?: number;
		weapon: number;
		attack: number;
		comboRate: number;
		comboCount?: number;
		armor: ArmorStats;
		successRate?: number;
		baseSuccessRate?: number;
		attackUpgrades?: number;
		comboUpgrades?: number;
		rebirthCount: number;
		memoryShards: number;
		resourceYield: Record<ResourceYieldKind, number>;
		resourceYieldUpgrades: Record<ResourceYieldKind, number>;
		successfulUpgradeCount: number;
	};
	let {
		game,
		currentLevel,
		form,
		onMaxHpChange
	}: {
		game: ForgeGame;
		currentLevel: number;
		form: { message?: string; game?: ForgeGame; effect?: GameEffect } | null;
		onMaxHpChange?: (maxHp: number, revision: number) => void;
	} = $props();
	let savedGame = $state<ForgeGame>();
	const currentGame = $derived(savedGame && savedGame.revision > game.revision ? savedGame : game);
	let selected = $state<UpgradeKind>('attack');
	let pending = $state<'upgrade' | 'memory' | 'rebirth' | null>(null);
	const busy = $derived(pending !== null);
	let phase = $state<'idle' | 'charging' | 'success' | 'failure' | 'error'>('idle');
	let requestError = $state('');
	let forgingLevel = $state(0);
	let alive = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let finishWait: (() => void) | undefined;
	onDestroy(() => {
		alive = false;
		clearTimeout(timer);
		finishWait?.();
	});
	let outcome = $state<{ success: boolean; gain: string } | null>(null);
	const base = $derived(currentGame.baseSuccessRate ?? 10);
	const rate = $derived(currentGame.successRate ?? base);
	const levels = $derived({
		chance: currentGame.successRate ?? currentGame.baseSuccessRate ?? 10,
		attack: currentGame.attackUpgrades ?? currentGame.weapon,
		income: currentGame.incomeUpgrades ?? 0,
		combo: currentGame.comboUpgrades ?? 0,
		maxHp: currentGame.armor.maxHpUpgrades,
		killRecovery: currentGame.armor.killRecoveryUpgrades,
		defense: currentGame.armor.defenseUpgrades
	});
	const level = $derived(levels[selected]);
	const cost = $derived(upgradeCost(level, selected, rate));
	const chance = $derived(upgradeChance(rate, selected));
	const maxSuccessfulUpgrades = $derived(successfulUpgradeLimit(currentGame.rebirthCount));
	const allowedSuccessfulUpgrades = $derived(
		availableUpgradeLimit(currentLevel, currentGame.rebirthCount)
	);
	const hasRequiredVocabularyLevel = $derived(
		vocabularyUpgradeLimit(currentLevel) >= maxSuccessfulUpgrades
	);
	const requiredVocabularyLevel = $derived((maxSuccessfulUpgrades / 10).toFixed(1));
	const upgradeLimitReached = $derived(
		currentGame.successfulUpgradeCount >= allowedSuccessfulUpgrades
	);
	const nextRebirthCost = $derived(rebirthCost(currentGame.rebirthCount + 1));
	const rebirthLacksResources = $derived(
		currentGame.gold < nextRebirthCost.gold ||
			currentGame.iron < nextRebirthCost.iron ||
			(currentGame.silver ?? 0) < nextRebirthCost.silver ||
			currentGame.stones < nextRebirthCost.stones
	);
	function resourceCost(kind: ResourceYieldKind) {
		return RESOURCE_YIELD_UPGRADE_COST(currentGame.resourceYieldUpgrades[kind]);
	}
	const enhanceMeta: SubmitFunction = ({ cancel, formData }) => {
		if (busy || phase !== 'idle') {
			cancel();
			return;
		}
		const action = formData.get('action');
		if (action !== 'memory-upgrade' && action !== 'rebirth') {
			cancel();
			return;
		}
		pending = action === 'rebirth' ? 'rebirth' : 'memory';
		requestError = '';
		return async ({ update, result }) => {
			try {
				await update({ invalidateAll: false });
				if (!alive) return;
				if (result.type === 'success' && form?.game) {
					savedGame = form.game;
					onMaxHpChange?.(savedGame.armor.maxHp, savedGame.revision);
				}
			} catch {
				if (alive) requestError = '요청 결과를 확인하지 못했어요. 진행 상황을 확인해 주세요.';
			} finally {
				pending = null;
			}
		};
	};
	const values = $derived({
		chance: currentGame.successRate ?? currentGame.baseSuccessRate ?? 10,
		attack: currentGame.attack,
		income: currentGame.hitGold ?? 1,
		combo: currentGame.comboRate,
		maxHp: currentGame.armor.maxHp,
		killRecovery: currentGame.armor.killRecovery,
		defense: currentGame.armor.defense
	});
	const selectedUpgrade = $derived(UPGRADE_DISPLAY[selected]);
	const cap = $derived(selectedUpgrade.cap ?? Infinity);
	const uncharged = $derived(chance === 0);
	const capped = $derived(values[selected] >= cap);
	const lacking = $derived(
		currentGame.gold < cost.gold ||
			currentGame.iron < cost.iron ||
			currentGame.stones < cost.stones ||
			(currentGame.silver ?? 0) < cost.silver
	);
	const accessoryKinds = ['chance'] as const;
	const weaponKinds = ['attack', 'income', 'combo'] as const;
	const armorKinds = ['maxHp', 'killRecovery', 'defense'] as const;
	const isArmor = $derived(armorKinds.some((kind) => kind === selected));
	const gainUnit = $derived(selectedUpgrade.unit === '%' ? '%p' : selectedUpgrade.unit);
	function formatValue(kind: UpgradeKind, value: number) {
		return kind === 'combo' || kind === 'defense' ? value.toFixed(1) : String(value);
	}
	const gainRange = $derived.by(() => {
		const { min, max, scale } = UPGRADE_GAINS[selected];
		const room = cap - values[selected];
		const lower = formatValue(selected, Math.min(min / scale, room));
		const upper = formatValue(selected, Math.min(max / scale, room));
		return `+${lower === upper ? lower : `${lower}~${upper}`}${gainUnit}`;
	});
</script>

<ForgeReveal
	{phase}
	kind={selected}
	label={selectedUpgrade.name}
	{isArmor}
	level={phase === 'charging' ? forgingLevel : level}
	{outcome}
	{chance}
	baseChance={base}
	onDismiss={() => {
		phase = 'idle';
	}}
/>

<section
	aria-label="장비 강화"
	aria-busy={busy}
	class="forge"
	class:working={pending === 'upgrade'}
>
	<div class="resources" aria-label="보유 자원">
		<span aria-label={`골드 ${currentGame.gold}`} title="골드"
			><span aria-hidden="true">🪙</span><b>{currentGame.gold.toLocaleString()}</b></span
		>
		<span aria-label={`철 ${currentGame.iron}`} title="철"
			><ResourceIcon kind="iron" /><b>{currentGame.iron.toLocaleString()}</b></span
		>
		<span aria-label={`은 ${currentGame.silver ?? 0}`} title="은"
			><ResourceIcon kind="silver" /> <b>{(currentGame.silver ?? 0).toLocaleString()}</b></span
		>
		<span aria-label={`강화석 ${currentGame.stones}`} title="강화석"
			><span aria-hidden="true">💎</span><b>{currentGame.stones.toLocaleString()}</b></span
		>
		<span aria-label={`기억의 파편 ${currentGame.memoryShards}`} title="기억의 파편"
			><span aria-hidden="true">✨</span><b>{currentGame.memoryShards.toLocaleString()}</b></span
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
			<span class="level">+{currentGame.weapon}</span>
		</div>
		<div class="weapon-info">
			<span class="eyebrow">무기</span>
			<h2>모험가의 검</h2>
		</div>
	</div>
	{#snippet upgradeOptions(kinds: readonly UpgradeKind[], label: string)}
		<div class="upgrade-options" role="group" aria-label={label}>
			{#each kinds as kind (kind)}
				<button
					type="button"
					class="button secondary"
					class:selected={selected === kind}
					aria-pressed={selected === kind}
					disabled={busy || phase !== 'idle'}
					onclick={() => (selected = kind)}
				>
					<span class="option-icon" aria-hidden="true"
						><ResourceIcon kind={UPGRADE_DISPLAY[kind].resource} /></span
					>
					<span class="option-copy"
						><span class="option-name">{UPGRADE_DISPLAY[kind].name}</span><strong
							>{formatValue(kind, values[kind])}<small>{UPGRADE_DISPLAY[kind].unit}</small></strong
						></span
					>
					<span class="selection-dot" aria-hidden="true">{selected === kind ? '✓' : ''}</span>
				</button>
			{/each}
		</div>
	{/snippet}
	{@render upgradeOptions(weaponKinds, '무기 강화 항목')}
	<h2 class="armor-title">방어구</h2>
	{@render upgradeOptions(armorKinds, '방어구 강화 항목')}
	<h2 class="armor-title">장신구</h2>
	{@render upgradeOptions(accessoryKinds, '장신구 강화 목록')}
	<form
		method="POST"
		use:enhance={({ cancel }) => {
			if (busy || phase !== 'idle' || capped || lacking || uncharged || upgradeLimitReached) {
				cancel();
				return;
			}
			const isChanceUpgrade = selected === 'chance';
			const before = values[selected];
			pending = 'upgrade';
			outcome = null;
			requestError = '';
			forgingLevel = level;
			if (!isChanceUpgrade) phase = 'charging';
			const started = Date.now();
			const duration =
				isChanceUpgrade || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1800;
			return async ({ update, result }) => {
				try {
					if (!isChanceUpgrade) {
						await new Promise<void>((resolve) => {
							finishWait = resolve;
							timer = setTimeout(resolve, Math.max(0, duration - (Date.now() - started)));
						});
					}
					if (!alive) return;
					await update({ invalidateAll: false });
					if (!alive) return;
					if (result.type === 'success' && form?.game) {
						savedGame = form.game;
						onMaxHpChange?.(savedGame.armor.maxHp, savedGame.revision);
					}
					if (!isChanceUpgrade && result.type === 'success')
						outcome = {
							success: form?.effect?.kind === 'upgrade-success',
							gain: `+${formatValue(selected, values[selected] - before)}${gainUnit}`
						};
					if (!isChanceUpgrade)
						phase = outcome ? (outcome.success ? 'success' : 'failure') : 'error';
				} catch {
					if (alive) {
						if (isChanceUpgrade)
							requestError = '강화 결과를 확인하지 못했어요. 자원을 확인해 주세요.';
						else phase = 'error';
					}
				} finally {
					pending = null;
				}
			};
		}}
	>
		<input type="hidden" name="kind" value={selected} /><input
			type="hidden"
			name="action"
			value="upgrade"
		/><input type="hidden" name="revision" value={currentGame.revision} />

		<div class="chance">
			<span>성공 확률 <b>{chance}%</b></span><span>{gainRange}</span>
		</div>
		<button
			class="button upgrade"
			disabled={busy || phase !== 'idle' || lacking || capped || uncharged || upgradeLimitReached}
			aria-busy={pending === 'upgrade'}
		>
			<span class="upgrade-title"
				>{pending === 'upgrade'
					? '강화 중…'
					: upgradeLimitReached
						? hasRequiredVocabularyLevel
							? '환생 필요'
							: `레벨 ${requiredVocabularyLevel} 필요`
						: capped
							? '최대치 도달'
							: `${selectedUpgrade.name} 강화`}</span
			>
			<span class="cost" aria-label="강화 비용">
				{#if cost.gold}🪙 {cost.gold}{/if}
				{#if cost.iron}<ResourceIcon kind="iron" />{cost.iron}{/if}
				{#if cost.silver}<ResourceIcon kind="silver" />{cost.silver}{/if}
				{#if cost.stones}💎{cost.stones}{/if}
			</span>
		</button>
		{#if upgradeLimitReached && !hasRequiredVocabularyLevel}
			<small class="short">어휘 레벨 {requiredVocabularyLevel} 이상부터 강화 한도가 늘어요.</small>
		{:else if upgradeLimitReached}<small class="short"
				>성공 강화 한도에 도달했어요. 자원을 모아 환생해 주세요.</small
			>{:else if uncharged}<small class="short">골드로 성공률을 먼저 충전해 주세요.</small
			>{:else if lacking && !capped}<small class="short">재료가 부족해요.</small>{/if}
	</form>

	<section class="meta-upgrades" aria-labelledby="memory-title">
		<div class="section-heading">
			<div>
				<span class="eyebrow">영구 성장</span>
				<h2 id="memory-title">기억의 파편</h2>
			</div>
			<strong>✨ {currentGame.memoryShards.toLocaleString()}</strong>
		</div>
		<p class="section-note">
			원하는 자원을 골라 보물상자에서 해당 자원의 획득량을 강화해요. 강화는 100% 성공하고 한 번에
			0.5~1.5%p 올라요.
		</p>
		<div class="memory-options">
			{#each RESOURCE_YIELD_KINDS as resource (resource)}
				<form method="POST" use:enhance={enhanceMeta}>
					<input type="hidden" name="action" value="memory-upgrade" />
					<input type="hidden" name="resource" value={resource} />
					<input type="hidden" name="revision" value={currentGame.revision} />
					<div>
						<strong>{RESOURCE_YIELD_NAMES[resource]} 획득량</strong>
						<span>{currentGame.resourceYield[resource].toFixed(1)}%</span>
					</div>
					<button
						class="button secondary"
						disabled={busy || phase !== 'idle' || currentGame.memoryShards < resourceCost(resource)}
					>
						{pending === 'memory'
							? '강화 중…'
							: `${RESOURCE_YIELD_NAMES[resource]} 강화 · 파편 ${resourceCost(resource)}개`}
					</button>
				</form>
			{/each}
		</div>
	</section>

	<section class="rebirth" aria-labelledby="rebirth-title">
		<div class="section-heading">
			<div>
				<span class="eyebrow">다음 환생 {currentGame.rebirthCount + 1}회</span>
				<h2 id="rebirth-title">환생</h2>
			</div>
			<strong>강화 {currentGame.successfulUpgradeCount} / {maxSuccessfulUpgrades}</strong>
		</div>
		<p class="section-note">
			환생하면 자원·장비 강화·상자·탐험 진행을 초기화하고, 기본 능력치와 획득량 강화는 유지해요.
			이번 환생 보상으로 기억의 파편 <b>{currentGame.rebirthCount + 1}</b>개를 얻어요.
		</p>
		<div class="rebirth-cost" aria-label="환생 비용">
			<span>🪙 {nextRebirthCost.gold.toLocaleString()}</span>
			<span><ResourceIcon kind="iron" /> {nextRebirthCost.iron.toLocaleString()}</span>
			<span><ResourceIcon kind="silver" /> {nextRebirthCost.silver.toLocaleString()}</span>
			<span>💎 {nextRebirthCost.stones.toLocaleString()}</span>
		</div>
		<form
			method="POST"
			use:enhance={enhanceMeta}
			onsubmit={(event) => {
				if (
					!window.confirm(
						'환생하면 자원과 장비 강화, 보물상자, 탐험 진행이 초기화돼요. 환생할까요?'
					)
				)
					event.preventDefault();
			}}
		>
			<input type="hidden" name="action" value="rebirth" />
			<input type="hidden" name="revision" value={currentGame.revision} />
			<button
				class="button upgrade"
				disabled={busy ||
					phase !== 'idle' ||
					!hasRequiredVocabularyLevel ||
					currentGame.successfulUpgradeCount < maxSuccessfulUpgrades ||
					rebirthLacksResources}
			>
				<span class="upgrade-title">{pending === 'rebirth' ? '환생 중…' : '환생하기'}</span>
				<span class="cost">✨ +{currentGame.rebirthCount + 1}</span>
			</button>
		</form>
		{#if !hasRequiredVocabularyLevel}
			<small class="short">
				어휘 레벨 {requiredVocabularyLevel} 이상부터 강화 한도 {maxSuccessfulUpgrades}회와 환생이
				열려요. 현재 레벨에서는 최대 {allowedSuccessfulUpgrades}회까지 강화할 수 있어요.
			</small>
		{:else if currentGame.successfulUpgradeCount < maxSuccessfulUpgrades}
			<small class="short">성공 강화 {maxSuccessfulUpgrades}회가 되면 환생할 수 있어요.</small>
		{:else if rebirthLacksResources}
			<small class="short">환생 재료가 부족해요.</small>
		{/if}
	</section>

	{#if form?.message}<p class="message" role="status">{form.message}</p>{/if}
	{#if requestError}<p class="message" role="alert">{requestError}</p>{/if}
	<details>
		<summary>강화 안내</summary>
		<p>
			기본 성공률은 단어 레벨 ×10을 버림한 {base}%예요. 골드로 +2~6%p씩 충전한 성공률은 무기와
			방어구가 함께 써요. 연계율은 2연속 정답부터 연속 횟수 × 연계율만큼 추가 피해를 주고(보너스
			최소 1), 오답이나 넘기기로 연계가 끊겨요. 연계율은 최대 {COMBO_RATE_CAP}%이고 추가 피해는
			공격력의 최대 {COMBAT_PERCENT_CAP}%예요. 방어력은 오답과 패스 피해를 줄여요.
		</p>
		<p>
			재료는 시도할 때 소모돼요. 실패해도 능력치는 유지되며 성공률은 변하지 않아요. 강화에 성공하면
			공통 성공률은 기본 {base}%로 돌아가요. 골드 비용은 현재 확률과 검 강화 단계가 높을수록
			증가해요.
		</p>
	</details>
</section>

<style>
	.meta-upgrades,
	.rebirth {
		margin-top: 1.2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 0.75rem;
	}
	.section-heading h2 {
		margin-bottom: 0;
	}
	.section-heading > strong {
		color: var(--brown);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.section-note {
		margin: 0.5rem 0 0.8rem;
		color: var(--ink-soft);
		font-size: 0.8rem;
	}
	.memory-options {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}
	.memory-options form {
		padding: 0.7rem;
		border: 1px solid var(--line);
		border-radius: 0.8rem;
		background: var(--paper);
	}
	.memory-options form > div {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.8rem;
	}
	.memory-options form > div span {
		font-variant-numeric: tabular-nums;
	}
	.memory-options .button {
		width: 100%;
		margin-top: 0.55rem;
		font-size: 0.75rem;
	}
	.rebirth-cost {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		margin-bottom: 0.75rem;
		font-size: 0.8rem;
	}
	.rebirth-cost span {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	@media (max-width: 380px) {
		.memory-options {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.armor-title {
		font-size: 1rem;
		margin: 0.9rem 0 0.55rem;
	}
	.upgrade-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
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
		border: 0.1rem solid var(--line);
		border-radius: 0.8rem;
		background: var(--paper);
		color: var(--brown);
		text-align: left;
		box-shadow: 0 2px 0 var(--paper-deep);
	}
	.upgrade-options button.selected {
		border-color: var(--brown);
		background: var(--paper-deep);
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
