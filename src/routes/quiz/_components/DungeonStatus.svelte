<script lang="ts">
	import { onDestroy, tick } from 'svelte';

	import type { BattleView, CombatUpdate, StudyReward } from '$lib/shared/types/journey.type';

	import BattleArena from '$lib/components/BattleArena.svelte';
	import ChestStash from '$lib/components/ChestStash.svelte';
	import ResourceIcon from '$lib/components/ResourceIcon.svelte';
	import { createGameAudio } from '$lib/shared/utils/game-audio';
	import { monsterStats } from '$lib/shared/utils/game.util';
	let {
		game,
		combat,
		onUpdate
	}: {
		game: {
			attack: number;
			criticalChance: number;
			gold: number;
			iron: number;
			stones: number;
			silver?: number;
			hitGold?: number;
			battle: BattleView;
		};
		combat: CombatUpdate | null;
		onUpdate: (value: CombatUpdate) => void;
	} = $props();
	const battle = $derived(combat?.battle ?? game.battle);
	const wallet = $derived(combat?.wallet ?? game);
	const reward = $derived(combat?.reward);
	let sound = $state(false);
	const showSoundOptions = false;
	let phase = $state<'idle' | 'charging' | 'reveal'>('idle');
	let loot = $state<StudyReward | null>(null);
	let revealedCount = $state(0);
	let lastRevealAt = 0;
	const rewards = $derived(
		loot
			? [
					{ key: 'gold', name: '골드', amount: loot.gold },
					{ key: 'iron', name: '철', amount: loot.iron },
					{ key: 'silver', name: '은', amount: loot.silver ?? 0 },
					{ key: 'stones', name: '강화석', amount: loot.stones }
				].filter((item) => item.amount > 0)
			: []
	);
	const remainingReveals = $derived(rewards.length - revealedCount);
	const currentDrop = $derived(rewards[revealedCount - 1]);
	const rareRevealed = $derived(
		rewards.slice(0, revealedCount).some((item) => item.key === 'stones')
	);
	function revealNext() {
		if (phase !== 'reveal' || remainingReveals <= 0 || Date.now() - lastRevealAt < 450) return;
		lastRevealAt = Date.now();
		revealedCount += 1;
		if (sound) audio.play(currentDrop?.key === 'stones' ? 'rare' : 'loot');
	}
	let openingId = $state<string | null>(null);
	let message = $state('');
	let chestTrigger = $state<HTMLButtonElement>();
	let soundButton = $state<HTMLButtonElement>();
	let chestDialog = $state<HTMLDialogElement>();
	$effect(() => {
		if (!chestDialog) return;
		if (phase !== 'idle' && !chestDialog.open) chestDialog.showModal();
		else if (phase === 'idle' && chestDialog.open) chestDialog.close();
	});
	let alive = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let finishWait: (() => void) | undefined;
	const audio = createGameAudio();
	$effect(() => {
		if (reward?.damage && sound) audio.play(reward.critical ? 'critical' : 'hit');
	});
	onDestroy(() => {
		alive = false;
		clearTimeout(timer);
		finishWait?.();
		audio.close();
	});
	async function open() {
		if (phase === 'charging') return;
		const id = openingId ?? battle.chests[0]?.id;
		if (!id) return;
		openingId = id;
		phase = 'charging';
		loot = null;
		revealedCount = 0;
		lastRevealAt = 0;
		message = '';
		if (sound) {
			audio.unlock();
			audio.play('loot');
		}
		try {
			const request = fetch('/api/game/chest', {
				method: 'POST',
				signal: AbortSignal.timeout(15000),
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id })
			}).then(async (response) => {
				if (!response.ok) throw new Error('상자를 열지 못했어요. 다시 눌러 주세요.');
				return (await response.json()) as CombatUpdate;
			});
			const wait = new Promise<void>((resolve) => {
				finishWait = resolve;
				timer = setTimeout(
					resolve,
					window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1750
				);
			});
			const [result] = await Promise.all([request, wait]);
			if (!alive) return;
			loot = result.reward;
			phase = 'reveal';
			onUpdate(result);
			if (sound) audio.play('loot');
		} catch (error) {
			if (!alive) return;
			phase = 'idle';
			message = error instanceof Error ? error.message : '다시 시도해 주세요.';
		}
	}
	async function dismiss() {
		phase = 'idle';
		openingId = null;
		loot = null;
		await tick();
		(chestTrigger ?? soundButton)?.focus();
	}
</script>

<aside class:rare={rareRevealed} aria-label="몬스터 전투">
	<div class="status-header">
		<div class="status-summary">
			<div class="resource-strip" aria-label="보유 자원">
				{#each [{ name: '골드', amount: wallet.gold }, { name: '철', amount: wallet.iron }, { name: '은', amount: wallet.silver ?? 0 }, { name: '강화석', amount: wallet.stones }] as resource (resource.name)}
					<div
						class="resource"
						aria-label={`${resource.name} ${resource.amount}`}
						title={resource.name}
					>
						<span class="resource-icon" aria-hidden="true"
							><ResourceIcon kind={resource.name} /></span
						>
						<b>{resource.amount.toLocaleString()}</b>
					</div>
				{/each}
			</div>
			{#if combat?.player}
				<div class="explorer" class:danger={combat.player.hp <= 25}>
					<span>{combat.player.hp === 0 ? '탈진 · 회복 중' : '탐험 중'}</span>
					{#key combat.revision}<div
							class="vitality"
							class:hurt={!!reward?.playerDamage}
							role="meter"
							aria-label="내 체력"
							aria-valuemin={0}
							aria-valuemax={combat.player.maxHp}
							aria-valuenow={combat.player.hp}
						>
							<span class="heart" aria-hidden="true">♥</span><b>{combat.player.hp}</b><small
								>/ {combat.player.maxHp}</small
							>
							{#if reward?.playerDamage}<b class="taken">−{reward.playerDamage}</b>{/if}
						</div>{/key}
				</div>
			{/if}
		</div>
		{#if phase === 'idle' && (battle.chests.length || openingId)}
			<div class="stash-corner">
				<ChestStash
					count={battle.chests.length}
					bossCount={battle.chests.filter((c) => c.boss).length}
					onOpen={open}
					bind:trigger={chestTrigger}
				/>
			</div>
		{/if}
	</div>

	{#if showSoundOptions}<div class="heading">
			<button
				bind:this={soundButton}
				class="sound"
				type="button"
				aria-pressed={sound}
				onclick={() => {
					sound = !sound;
					if (sound) audio.unlock();
				}}>소리 {sound ? '켜짐' : '꺼짐'}</button
			>
		</div>{/if}
	<BattleArena {battle} {reward} eventId={combat?.revision ?? 0} />
	{#key combat}<p class="feedback" role="status">
			{reward?.clear
				? `${reward.critical ? '치명타로 ' : ''}처치 성공! 보물상자를 발견했어요.`
				: reward?.damage
					? `${reward.critical ? '크리티컬! 2배 공격 ·' : '명중!'} 골드 +${reward.gold}`
					: reward?.playerDamage
						? `${reward.playerCritical ? '몬스터의 치명타! ' : '몬스터의 반격! '}체력 −${reward.playerDamage}${reward.healing ? ` · 몬스터 회복 +${reward.healing}` : ''}`
						: reward?.healing
							? `몬스터가 체력을 ${reward.healing} 회복했어요.`
							: ''}
		</p>{/key}
	<div class="battle-tools">
		<details>
			<summary>전투 정보</summary>
			<p>탈진 전에는 체력이 1분마다 2씩 회복돼요. 탈진하면 10분간 휴식이 필요해요.</p>
			<p>
				공격력 {game.attack} · 치명타 {game.criticalChance.toFixed(1)}% · 오답 피해: 단어 레벨 ×{battle.boss
					? 3
					: 2} · 넘기기: 몬스터 회복 ×3 + 치명타 반격 (오답 피해 ×2)
			</p>
			<p>
				명중 🪙 {(combat?.hitGold ?? game.hitGold ?? 1) * (battle.boss ? 2 : 1)}{battle.boss
					? ' (보스 ×2)'
					: ''} · 상자 ×{monsterStats(battle.level ?? 10).rewardMultiplier.toFixed(2)}
			</p>
		</details>
	</div>

	{#if message}<p role="alert">{message}</p>{/if}
</aside>

{#snippet treasure()}
	<div class="treasure" class:charging={phase === 'charging'} class:revealed={phase === 'reveal'}>
		<div class="rays" aria-hidden="true"></div>
		<button
			bind:this={chestTrigger}
			class="chest"
			type="button"
			onclick={() => (phase === 'reveal' ? revealNext() : open())}
			disabled={phase === 'charging' || (phase === 'reveal' && remainingReveals === 0)}
			aria-label={phase === 'charging'
				? '보물상자 여는 중'
				: phase === 'reveal'
					? '다음 보물 공개'
					: '보물상자 열기'}
		>
			<span class="lid"></span><span class="box"></span><span class="lock"></span>
		</button>
		{#if phase === 'reveal' && loot}
			<span class="remaining" role="status"
				>남은 공개 <b>{remainingReveals}</b> / {rewards.length}</span
			>
			{#key revealedCount}
				{#if currentDrop}
					<div class="burst" aria-hidden="true">
						{#each Array.from({ length: 12 }) as _, i (i)}<i
								style={`--angle:${i * 30}deg;--delay:${(i % 3) * 40}ms`}
							></i>{/each}
					</div>
					<strong class="treasure-title"
						>{currentDrop.key === 'stones'
							? '희귀 보물 발견!'
							: `${currentDrop.name} 획득!`}</strong
					>
					<div class="loot" role="status">
						<span class:gem={currentDrop.key === 'stones'}
							><ResourceIcon kind={currentDrop.key} /><b>+{currentDrop.amount}</b><small
								>{currentDrop.name}</small
							></span
						>
					</div>
				{:else}
					<strong class="treasure-title">어떤 보물이 들어 있을까요?</strong>
					<div class="mystery" aria-hidden="true">✦ ? ✦</div>
				{/if}
			{/key}
			{#if remainingReveals > 0}
				<button class="button secondary collect" type="button" onclick={revealNext}
					>터치해서 {revealedCount ? '다음 보물' : '첫 보물'} 공개</button
				>
			{:else}
				<div class="collected" aria-label="획득한 보물">
					{#each rewards as item (item.key)}<span
							><ResourceIcon kind={item.key} /> {item.name} +{item.amount}</span
						>{/each}
				</div>
				<button class="button secondary collect" type="button" onclick={dismiss}
					>{battle.chests.length
						? `다음 상자 · ${battle.chests.length}개 남음`
						: '좋아, 계속 모험하기'}</button
				>
			{/if}
		{:else}<strong class="treasure-title"
				>{phase === 'charging'
					? '안에서 무언가 빛나고 있어요…'
					: '보물상자를 눌러 열어보세요'}</strong
			><small>{battle.chests.length}개 보관 중 · 열기 비용 없음</small>{/if}
		{#if message}<p role="alert">{message}</p>{/if}
	</div>
{/snippet}
<dialog
	bind:this={chestDialog}
	class="chest-dialog"
	class:rare={rareRevealed}
	aria-label="보물상자 개봉"
	oncancel={(event) => {
		if (phase === 'charging' || remainingReveals > 0) event.preventDefault();
		else dismiss();
	}}
>
	{#if phase !== 'idle'}{@render treasure()}{/if}
</dialog>

<style>
	.status-header {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.status-summary {
		flex: 1;
		min-width: 0;
	}
	.resource-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		margin-bottom: 0.45rem;
	}
	.resource {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}
	.resource-icon {
		font-size: 1.15rem;
		color: var(--brown);
	}
	.resource b {
		font-size: 0.8rem;
		color: var(--brown);
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	@media (max-width: 400px) {
		.resource {
			gap: 0.25rem;
		}
		.resource-icon {
			font-size: 0.9rem;
		}
		.resource b {
			font-size: 0.8rem;
		}
	}
	.explorer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 0.35rem;
		margin-bottom: 0.4rem;
		border-bottom: 1px solid var(--line);
		font-size: 0.75rem;
		color: var(--ink-soft);
	}
	.vitality {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
		font-variant-numeric: tabular-nums;
	}
	.vitality b {
		font-size: 1rem;
		color: var(--ink);
	}
	.heart,
	.danger .vitality b {
		color: var(--red);
	}
	.vitality small {
		font-size: 0.75rem;
	}
	.vitality .taken {
		font-size: 0.85rem;
		margin-left: 0.3rem;
		color: var(--red);
	}
	.heading {
		position: relative;
	}
	.heading .sound {
		position: absolute;
		right: 0;
		font-size: 0.7rem;
	}

	.taken {
		color: #b7392e;
		display: inline-block;
		margin-right: 0.5rem;
		animation: taken 0.65s ease-out;
	}
	.hurt {
		animation: hurt 0.45s ease-out;
	}
	@keyframes hurt {
		25%,
		65% {
			transform: translateX(-5px);
		}
		45%,
		85% {
			transform: translateX(5px);
		}
	}
	@keyframes taken {
		from {
			transform: scale(1.7);
		}
		to {
			transform: scale(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hurt,
		.taken {
			animation: none;
		}
	}

	.battle-tools {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 0.6rem;
		margin-top: 0.3rem;
		font-size: 0.8rem;
	}
	.battle-tools details {
		color: var(--ink-soft);
	}
	.battle-tools p {
		margin: 0.4rem 0;
	}
	.battle-tools summary {
		cursor: pointer;
	}
	.stash-corner {
		flex-shrink: 0;
	}
	.feedback:empty {
		display: none;
	}
	.feedback {
		text-align: center;
	}

	.chest-dialog {
		position: fixed;
		inset: 0;
		margin: 0;
		padding: 0;
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		border: 0;
		overflow: auto;
		color: var(--ink);
		background: radial-gradient(ellipse at 50% 40%, #fff7dc, #ecd2ac 75%);
	}
	.chest-dialog::backdrop {
		background: #68472499;
		backdrop-filter: blur(8px);
	}
	.chest-dialog .treasure {
		min-height: 100%;
		margin: 0;
		border-radius: 0;
		padding: max(2rem, env(safe-area-inset-top)) 1rem max(2rem, env(safe-area-inset-bottom));
		align-content: center;
		gap: 1.4rem;
		background: transparent;
		overflow: hidden;
	}
	.chest-dialog .chest {
		scale: 1.8;
		margin: 40px 0 48px;
	}
	.chest-dialog .charging .chest {
		animation:
			grand-rattle 0.2s 1s infinite alternate,
			levitate 1.75s ease-in-out both;
	}
	.chest-dialog .revealed .chest {
		animation: chest-impact 0.6s both;
	}
	.chest-dialog .rays {
		width: min(110vw, 800px);
		height: min(110vw, 800px);
		top: 40%;
		left: 50%;
		translate: -50% -50%;
		background: repeating-conic-gradient(#eac47880 0deg 10deg, transparent 10deg 30deg);
	}
	.chest-dialog .charging .rays {
		opacity: 0.5;
		animation: light-gather 1.75s ease-in both;
	}
	.chest-dialog .revealed .rays {
		animation: shine 14s linear infinite;
	}
	.chest-dialog .treasure-title {
		font-size: clamp(1.25rem, 4vw, 2rem);
		text-align: center;
	}
	.chest-dialog .loot {
		gap: clamp(0.5rem, 3vw, 1.3rem);
	}
	.chest-dialog .loot > span {
		min-width: clamp(78px, 20vw, 120px);
		padding: 1rem 0.7rem;
		font-size: 2rem;
		box-shadow:
			0 5px 0 #c8a47040,
			0 10px 25px #b68b3820;
		animation-duration: 0.65s;
	}
	.chest-dialog .loot > span:nth-child(2) {
		animation-delay: 0.3s;
	}
	.chest-dialog .loot > span:nth-child(3) {
		animation-delay: 0.65s;
	}
	.chest-dialog .loot b {
		font-size: 1.6rem;
	}
	.chest-dialog .burst {
		top: 37%;
	}
	.chest-dialog .burst i {
		width: 9px;
		height: 14px;
		animation-name: grand-burst;
		animation-duration: 1.2s;
	}
	.chest-dialog .collect {
		padding: 0.8rem 1.5rem;
		border: 1px solid var(--line);
		border-radius: 2rem;
		font-size: 1rem;
		animation: none;
	}
	@keyframes grand-rattle {
		from {
			rotate: -5deg;
		}
		to {
			rotate: 5deg;
		}
	}
	@keyframes levitate {
		from {
			transform: translateY(25px);
			opacity: 0.4;
		}
		60% {
			transform: translateY(-10px);
			opacity: 1;
		}
		to {
			transform: translateY(-10px);
			filter: drop-shadow(0 0 18px #e0a83b);
		}
	}
	@keyframes light-gather {
		from {
			transform: scale(1.4) rotate(-15deg);
			opacity: 0;
		}
		to {
			transform: scale(0.8) rotate(15deg);
			opacity: 0.65;
		}
	}
	@keyframes chest-impact {
		0% {
			transform: translateY(-10px);
		}
		35% {
			transform: scale(1.15);
			filter: drop-shadow(0 0 25px #eac36c);
		}
		to {
			transform: none;
		}
	}
	@keyframes grand-burst {
		from {
			opacity: 1;
			transform: rotate(var(--angle)) translateY(-40px);
		}
		to {
			opacity: 0;
			transform: rotate(var(--angle)) translateY(-320px) rotate(120deg);
		}
	}

	aside {
		padding: 0.7rem 1rem;
		border: 1px solid var(--line);
		border-radius: 1.2rem;
		background: var(--paper-soft);
		overflow: hidden;
	}
	.heading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
	}
	.sound {
		border: 0;
		background: transparent;
		color: var(--ink-soft);
		cursor: pointer;
	}

	small {
		color: var(--ink-soft);
		font-size: 0.75rem;
	}
	.feedback {
		font-size: 0.85rem;
		min-height: 1.3em;
		margin: 0.7rem 0 0;
		color: var(--brown);
	}

	.treasure {
		overflow: hidden;
		position: relative;
		display: grid;
		justify-items: center;
		gap: 0.65rem;
		margin-top: 1rem;
		padding: 1.3rem 0.5rem;
		border-radius: 0.8rem;
		background: radial-gradient(ellipse at 50% 35%, #fff1ce, var(--paper-deep) 75%);
		isolation: isolate;
	}
	.chest {
		position: relative;
		width: 100px;
		height: 90px;
		border: 0;
		background: none;
		cursor: pointer;
		filter: drop-shadow(0 8px 5px #71512330);
		transition: transform 0.2s;
	}
	.chest:enabled:hover {
		transform: translateY(-4px) rotate(-3deg);
	}
	.chest:focus-visible {
		outline: 3px solid #6b4c24;
		outline-offset: 5px;
		border-radius: 10px;
	}
	.box {
		position: absolute;
		left: 8px;
		bottom: 5px;
		width: 84px;
		height: 47px;
		border: 5px solid #e6b957;
		border-radius: 4px 4px 10px 10px;
		background: repeating-linear-gradient(0deg, #8d522f 0 13px, #734326 13px 16px);
		box-sizing: border-box;
	}
	.lid {
		position: absolute;
		z-index: 2;
		left: 8px;
		top: 15px;
		width: 84px;
		height: 28px;
		border: 5px solid #efc86c;
		border-radius: 16px 16px 3px 3px;
		box-sizing: border-box;
		background: #aa6d39;
		transform-origin: 50% 100%;
	}
	.lock {
		position: absolute;
		z-index: 3;
		width: 14px;
		height: 19px;
		background: #ffdb75;
		border: 3px solid #c89033;
		border-radius: 4px;
		top: 38px;
		left: 40px;
	}
	.charging .chest {
		animation:
			rattle 0.16s infinite alternate,
			charge 1s ease-in forwards;
	}
	.charging .lock {
		box-shadow: 0 0 20px #fff6aa;
	}
	.revealed .lid {
		animation: lid-open 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}
	.revealed .lock {
		opacity: 0;
	}
	.rays {
		position: absolute;
		pointer-events: none;
		z-index: -1;
		width: 230px;
		height: 230px;
		top: -40px;
		border-radius: 50%;
		background: repeating-conic-gradient(#ffdb7770 0deg 12deg, transparent 12deg 30deg);
		opacity: 0;
	}
	.revealed .rays {
		opacity: 1;
		animation: shine 8s linear infinite;
	}
	.rare .treasure {
		overflow: hidden;
		background: radial-gradient(ellipse at 50% 35%, #ffe9af, var(--paper-deep));
	}
	.rare .rays {
		background: repeating-conic-gradient(#dfb45d75 0deg 12deg, transparent 12deg 30deg);
	}
	.treasure-title {
		font-size: 0.95rem;
		z-index: 1;
	}
	.loot {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 1rem;
		z-index: 1;
	}
	.loot > span {
		display: grid;
		justify-items: center;
		min-width: 62px;
		padding: 0.7rem;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 0.7rem;
		font-size: 1.5rem;
		animation: loot-pop 0.55s backwards;
	}
	.loot > span:nth-child(2) {
		animation-delay: 0.15s;
	}
	.loot > span:nth-child(3) {
		animation-delay: 0.4s;
	}
	.loot b {
		font-size: 1.15rem;
	}
	.loot .gem {
		border-color: #b78b40;
		box-shadow: 0 0 18px #dcad5470;
	}
	.burst {
		pointer-events: none;
		position: absolute;
		top: 65px;
		left: 50%;
	}
	.burst i {
		position: absolute;
		width: 7px;
		height: 11px;
		border-radius: 2px;
		background: #e9b23b;
		animation: particle 0.8s var(--delay) both;
	}
	.collect {
		margin-top: 0.4rem;
		font-size: 0.85rem;
		z-index: 1;
	}

	@keyframes rattle {
		from {
			rotate: -4deg;
		}
		to {
			rotate: 4deg;
		}
	}
	@keyframes charge {
		to {
			scale: 1.12;
			filter: drop-shadow(0 0 15px #eab94c);
		}
	}
	@keyframes lid-open {
		to {
			transform: translateY(-24px) rotate(-18deg);
		}
	}
	@keyframes shine {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes loot-pop {
		from {
			opacity: 0;
			transform: translateY(-30px) scale(0.3);
		}
		70% {
			transform: translateY(4px) scale(1.12);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes particle {
		from {
			opacity: 1;
			transform: rotate(var(--angle)) translateY(0);
		}
		to {
			opacity: 0;
			transform: rotate(var(--angle)) translateY(120px) rotate(100deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		*,
		*::before,
		*::after {
			animation: none !important;
			transition: none !important;
		}
		.burst {
			display: none;
		}
		.revealed .lid {
			transform: translateY(-24px) rotate(-18deg);
		}
	}
</style>
