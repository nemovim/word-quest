import { randomInt } from 'node:crypto';

import { error } from '@sveltejs/kit';

import type { GameEffect } from '$lib/shared/types/game-effect.type';
import type { User } from '$lib/shared/types/user.type';

import { createFreshBattle } from '$lib/server/game';
import {
	DEFAULT_ARMOR,
	GameModel,
	changedGameFields,
	createInitialGameState,
	gameProgressView,
	readGameState,
	withUpgradeRate,
	type GameState
} from '$lib/server/game-state';
import {
	COMBAT_PERCENT_CAP,
	COMBO_RATE_CAP,
	RESOURCE_YIELD_NAMES,
	RESOURCE_YIELD_UPGRADE_COST,
	RESOURCE_YIELD_UPGRADE_GAINS,
	UPGRADE_GAINS,
	availableUpgradeLimit,
	baseUpgradeChance,
	isUpgradeKind,
	isResourceYieldKind,
	rebirthCost,
	successfulUpgradeLimit,
	upgradeChance,
	upgradeCost,
	vocabularyUpgradeLimit
} from '$lib/shared/utils/game.util';

type GameAction = 'upgrade' | 'memory-upgrade' | 'rebirth';
function isGameAction(value: FormDataEntryValue | null): value is GameAction {
	return value === 'upgrade' || value === 'memory-upgrade' || value === 'rebirth';
}

export async function actGame(user: User, form: FormData) {
	const action = form.get('action');
	if (!isGameAction(action)) error(400, '알 수 없는 행동이에요.');
	if (action === 'upgrade') {
		const snapshot = await readGameState(user);
		const state = snapshot?.state ?? withUpgradeRate(createInitialGameState(), user);
		return actGameLocked(user, form, action, state, snapshot?.original);
	}
	await GameModel.updateOne(
		{ _id: user._id },
		{ $setOnInsert: { state: createInitialGameState(), lockUntil: 0 } },
		{ upsert: true }
	);
	const lockUntil = Date.now() + 120_000;
	const locked = await GameModel.updateOne(
		{
			_id: user._id,
			'state.revision': Number(form.get('revision')),
			lockUntil: { $lte: Date.now() }
		},
		{ $set: { lockUntil } }
	);
	if (locked.modifiedCount !== 1)
		error(409, '다른 요청이 진행 중이거나 진행 상황이 바뀌었어요. 새로고침 후 다시 시도해 주세요.');
	try {
		const state =
			(await readGameState(user))?.state ?? withUpgradeRate(createInitialGameState(), user);
		return await actGameLocked(user, form, action, state);
	} finally {
		await GameModel.updateOne({ _id: user._id, lockUntil }, { $set: { lockUntil: 0 } });
	}
}

async function actGameLocked(
	user: User,
	form: FormData,
	action: GameAction,
	state: GameState,
	original?: GameState
) {
	const revision = Number(form.get('revision'));
	if (revision !== state.revision)
		error(409, '진행 상황이 바뀌었어요. 새로고침 후 다시 시도해 주세요.');
	const before = {
		gold: state.gold,
		iron: state.iron,
		stones: state.stones
	};
	let message = '';
	let upgradeSucceeded = false;
	if (action === 'upgrade') {
		const kind = form.get('kind');
		if (!isUpgradeKind(kind)) error(400, '강화할 항목을 선택해 주세요.');
		const allowedUpgrades = availableUpgradeLimit(user.currentLevel, state.rebirthCount);
		if (state.successfulUpgradeCount >= allowedUpgrades) {
			const upgradeLimit = successfulUpgradeLimit(state.rebirthCount);
			if (vocabularyUpgradeLimit(user.currentLevel) < upgradeLimit)
				error(400, `어휘 레벨 ${(upgradeLimit / 10).toFixed(1)} 이상부터 강화 한도가 늘어요.`);
			error(400, '강화 한도에 도달했어요. 자원을 모아 환생해 주세요.');
		}
		if (kind !== 'chance' && state.successRate <= 0)
			error(400, '골드로 강화 성공률을 먼저 충전해 주세요.');
		if (kind === 'chance' && state.successRate >= 100) error(400, '강화 성공률이 이미 최대예요.');
		if (kind === 'combo' && state.comboRate >= COMBO_RATE_CAP)
			error(400, '연계율이 이미 최대예요.');
		const armor = state.armor;
		if (kind === 'defense' && armor.defense >= COMBAT_PERCENT_CAP)
			error(400, '방어력이 이미 최대예요.');
		const levels = {
			chance: state.weapon,
			attack: state.attackUpgrades,
			combo: state.comboUpgrades,
			income: state.incomeUpgrades,
			maxHp: armor.maxHpUpgrades,
			killRecovery: armor.killRecoveryUpgrades,
			defense: armor.defenseUpgrades
		};
		const cost = upgradeCost(levels[kind], kind, state.successRate);
		if (
			state.gold < cost.gold ||
			state.iron < cost.iron ||
			state.stones < cost.stones ||
			state.silver < cost.silver
		)
			error(400, '강화 재료가 부족해요.');
		state.gold -= cost.gold;
		state.iron -= cost.iron;
		state.stones -= cost.stones;
		state.silver -= cost.silver;
		const range = UPGRADE_GAINS[kind];
		if (kind === 'chance') {
			const gain = Math.min(
				range.min + randomInt(range.max - range.min + 1),
				100 - state.successRate
			);
			state.successRate += gain;
			state.chanceUpgrades += 1;
			upgradeSucceeded = true;
			message = `강화 성공률 +${gain}%p → ${state.successRate}%`;
		} else if (randomInt(100) < upgradeChance(state.successRate, kind)) {
			const gain = (range.min + randomInt(range.max - range.min + 1)) / range.scale;
			upgradeSucceeded = true;
			if (kind === 'attack') {
				state.attack += gain;
				state.attackUpgrades += 1;
				message = `공격력 +${gain} → ${state.attack}`;
			} else if (kind === 'income') {
				state.hitGold += gain;
				state.incomeUpgrades += 1;
				message = `명중 골드 +${gain} → ${state.hitGold}`;
			} else if (kind === 'maxHp') {
				armor.maxHp += gain;
				armor.maxHpUpgrades += 1;
				if (state.player) {
					if (state.player.hp === state.player.maxHp) state.player.healedAt = Date.now();
					state.player.maxHp = armor.maxHp;
				}
				message = `최대 체력 +${gain} → ${armor.maxHp}`;
			} else if (kind === 'killRecovery') {
				armor.killRecovery += gain;
				armor.killRecoveryUpgrades += 1;
				message = `처치 회복 +${gain} → ${armor.killRecovery}`;
			} else {
				const previous = kind === 'combo' ? state.comboRate : armor.defense;
				const cap = kind === 'combo' ? COMBO_RATE_CAP : COMBAT_PERCENT_CAP;
				const next = Math.min(cap, Math.round((previous + gain) * 10) / 10);
				if (kind === 'combo') {
					state.comboRate = next;
					state.comboUpgrades += 1;
				} else {
					armor.defense = next;
					armor.defenseUpgrades += 1;
				}
				const label = kind === 'combo' ? '연계율' : '방어력';
				message = `${label} +${(next - previous).toFixed(1)}%p → ${next.toFixed(1)}%`;
			}
			if (kind === 'attack' || kind === 'income' || kind === 'combo') state.weapon += 1;
			state.successRate = baseUpgradeChance(user.currentLevel);
			state.baseSuccessRate = state.successRate;
			state.chanceUpgrades = 0;
			message += ` · 기본 성공률 ${state.successRate}%로 초기화`;
		} else {
			message = `강화 실패 · 능력치 유지 · 성공률 ${state.successRate}%`;
		}
		if (kind !== 'chance' && upgradeSucceeded) state.successfulUpgradeCount += 1;
	} else if (action === 'memory-upgrade') {
		const resource = form.get('resource');
		if (!isResourceYieldKind(resource)) error(400, '강화할 자원을 선택해 주세요.');
		const cost = RESOURCE_YIELD_UPGRADE_COST(state.resourceYieldUpgrades[resource]);
		if (!Number.isSafeInteger(cost) || state.memoryShards < cost)
			error(400, '기억의 파편이 부족해요.');
		const range = RESOURCE_YIELD_UPGRADE_GAINS;
		const increase = (range.min + randomInt(range.max - range.min + 1)) / range.scale;
		const nextYield = Math.round((state.resourceYield[resource] + increase) * 10) / 10;
		if (!Number.isFinite(nextYield)) error(400, '자원 획득량을 더 이상 강화할 수 없어요.');
		state.memoryShards -= cost;
		state.resourceYieldUpgrades[resource] += 1;
		state.resourceYield[resource] = nextYield;
		message = `${RESOURCE_YIELD_NAMES[resource]} 획득량 +${increase.toFixed(1)}%p → ${state.resourceYield[resource].toFixed(1)}%`;
	} else if (action === 'rebirth') {
		const nextRebirth = state.rebirthCount + 1;
		const upgradeLimit = successfulUpgradeLimit(state.rebirthCount);
		const vocabularyLimit = vocabularyUpgradeLimit(user.currentLevel);
		if (vocabularyLimit < upgradeLimit)
			error(400, `어휘 레벨 ${(upgradeLimit / 10).toFixed(1)} 이상이어야 환생할 수 있어요.`);
		if (state.successfulUpgradeCount < upgradeLimit)
			error(400, `성공 강화 ${upgradeLimit}회를 달성해야 환생할 수 있어요.`);
		const cost = rebirthCost(nextRebirth);
		if (!Object.values(cost).every(Number.isFinite))
			error(400, '환생 횟수가 너무 많아 진행할 수 없어요.');
		if (
			state.gold < cost.gold ||
			state.iron < cost.iron ||
			state.silver < cost.silver ||
			state.stones < cost.stones
		)
			error(400, '환생에 필요한 자원이 부족해요.');

		state.rebirthCount = nextRebirth;
		state.memoryShards += nextRebirth;
		state.gold = 0;
		state.iron = 0;
		state.silver = 0;
		state.stones = 0;
		state.weapon = 0;
		state.attack = 10;
		state.attackUpgrades = 0;
		state.hitGold = 1;
		state.incomeUpgrades = 0;
		state.comboRate = 0;
		state.comboUpgrades = 0;
		state.comboCount = 0;
		state.armor = { ...DEFAULT_ARMOR };
		state.successfulUpgradeCount = 0;
		state.successRate = baseUpgradeChance(user.currentLevel);
		state.baseSuccessRate = state.successRate;
		state.chanceUpgrades = 0;
		state.upgradeFailures = 0;
		state.victories = 0;
		state.player = undefined;
		state.battle = createFreshBattle(user.currentLevel);
		message = `환생 ${nextRebirth}회 완료 · 기억의 파편 +${nextRebirth}`;
	}
	state.revision += 1;
	const result = await GameModel.updateOne(
		{
			_id: user._id,
			'state.revision': revision,
			...(action === 'upgrade' ? { lockUntil: { $lte: Date.now() } } : {})
		},
		{ $set: original ? changedGameFields(original, state) : { state } }
	);
	if (result.modifiedCount !== 1)
		error(409, '다른 창에서 진행 상황이 바뀌었어요. 새로고침해 주세요.');
	const effect: GameEffect = {
		id: state.revision,
		kind:
			action === 'upgrade' ? (upgradeSucceeded ? 'upgrade-success' : 'upgrade-failure') : 'none',
		damage: 0,
		gold: Math.max(0, state.gold - before.gold),
		iron: Math.max(0, state.iron - before.iron),
		stones: Math.max(0, state.stones - before.stones),
		clear: null
	};
	const game =
		action === 'upgrade' || action === 'memory-upgrade' || action === 'rebirth'
			? gameProgressView(state)
			: undefined;
	return { message, effect, game };
}
