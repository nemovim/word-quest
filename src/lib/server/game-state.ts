import { isDeepStrictEqual } from 'node:util';

import mongoose from 'mongoose';

import type {
	ArmorStats,
	BattleView,
	PlayerHealth,
	StudyReward
} from '$lib/shared/types/combat.type';
import type { User } from '$lib/shared/types/user.type';

import {
	baseUpgradeChance,
	COMBO_RATE_CAP,
	monsterLevel,
	monsterStats,
	type ResourceYieldKind
} from '$lib/shared/utils/game.util';

export type Battle = BattleView & {
	claims: { key: string; at: number }[];
	opened: Record<string, StudyReward>;
};
export type GameState = {
	baseSuccessRate?: number;
	silver: number;
	hitGold: number;
	incomeUpgrades: number;
	chargeVersion?: number;
	successRate: number;
	chanceUpgrades: number;
	attackUpgrades: number;
	comboUpgrades: number;
	comboRate: number;
	comboCount: number;
	rebirthCount: number;
	memoryShards: number;
	resourceYield: Record<ResourceYieldKind, number>;
	resourceYieldUpgrades: Record<ResourceYieldKind, number>;
	successfulUpgradeCount: number;
	combatVersion?: number;
	player?: PlayerHealth;
	battle?: Battle;
	revision: number;
	gold: number;
	iron: number;
	stones: number;
	weapon: number;
	attack: number;
	armor: ArmorStats;
	upgradeFailures: number;
	victories: number;
};
export type GameSnapshot = { state: GameState; original: GameState };
export type GameProgressState = Pick<
	GameState,
	| 'revision'
	| 'gold'
	| 'iron'
	| 'stones'
	| 'silver'
	| 'hitGold'
	| 'incomeUpgrades'
	| 'weapon'
	| 'attack'
	| 'comboRate'
	| 'comboCount'
	| 'armor'
	| 'successRate'
	| 'baseSuccessRate'
	| 'attackUpgrades'
	| 'comboUpgrades'
	| 'rebirthCount'
	| 'memoryShards'
	| 'resourceYield'
	| 'resourceYieldUpgrades'
	| 'successfulUpgradeCount'
>;
const schema = new mongoose.Schema({
	_id: { type: String, required: true },
	state: { type: mongoose.Schema.Types.Mixed, required: true },
	lockUntil: { type: Number, default: 0 }
});
export const GameModel = mongoose.models.Game ?? mongoose.model('Game', schema);
const COMBAT_VERSION = 10;
export const DEFAULT_ARMOR: ArmorStats = {
	maxHp: 100,
	maxHpUpgrades: 0,
	killRecovery: 0,
	killRecoveryUpgrades: 0,
	defense: 0,
	defenseUpgrades: 0
};
const DEFAULT_RESOURCE_YIELD = { gold: 0, iron: 0, silver: 0, stones: 0 };
export const createInitialGameState = (): GameState => ({
	combatVersion: COMBAT_VERSION,
	silver: 0,
	hitGold: 1,
	incomeUpgrades: 0,
	chargeVersion: 1,
	successRate: 0,
	chanceUpgrades: 0,
	attackUpgrades: 0,
	comboUpgrades: 0,
	comboRate: 0,
	comboCount: 0,
	rebirthCount: 0,
	memoryShards: 0,
	resourceYield: { ...DEFAULT_RESOURCE_YIELD },
	resourceYieldUpgrades: { ...DEFAULT_RESOURCE_YIELD },
	successfulUpgradeCount: 0,
	revision: 0,
	gold: 0,
	iron: 0,
	stones: 0,
	weapon: 0,
	attack: 10,
	armor: { ...DEFAULT_ARMOR },
	upgradeFailures: 0,
	victories: 0
});

function nonnegativeInteger(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
function normalizeResourceRecord(
	value: unknown,
	integer = false
): Record<ResourceYieldKind, number> {
	return {
		gold: normalizeResourceAmount(value, 'gold', integer),
		iron: normalizeResourceAmount(value, 'iron', integer),
		silver: normalizeResourceAmount(value, 'silver', integer),
		stones: normalizeResourceAmount(value, 'stones', integer)
	};
}
function normalizeResourceAmount(
	value: unknown,
	kind: ResourceYieldKind,
	integer: boolean
): number {
	if (!value || typeof value !== 'object') return 0;
	const amount = Reflect.get(value, kind);
	if (typeof amount !== 'number' || !Number.isFinite(amount)) return 0;
	const nonnegativeAmount = Math.max(0, amount);
	return integer ? Math.floor(nonnegativeAmount) : nonnegativeAmount;
}
export function changedGameFields(original: GameState, state: GameState): Record<string, unknown> {
	const changed: Record<string, unknown> = {};
	function addChanges(
		prefix: string,
		before: Record<string, unknown>,
		after: Record<string, unknown>
	) {
		for (const [key, value] of Object.entries(after)) {
			if (!isDeepStrictEqual(before[key], value)) changed[prefix + key] = value;
		}
	}
	const { battle, ...fields } = state;
	addChanges('state.', original, fields);
	if (battle && original.battle) addChanges('state.battle.', original.battle, battle);
	else if (battle) changed['state.battle'] = battle;
	return changed;
}

export async function readGameState(user: User): Promise<GameSnapshot | null> {
	const document = await GameModel.findById(user._id, {
		'state.expedition': 0,
		'state.journey': 0
	}).lean<{
		state: GameState;
	}>();
	if (!document) return null;
	const state = document.state;
	const original = structuredClone(state);
	if ((state.combatVersion ?? 0) < 2) {
		const battle = state.battle;
		if (battle) {
			battle.level = monsterLevel(battle.level ?? 1);
			battle.chests = battle.chests.map((chest) => ({
				...chest,
				level: monsterLevel(chest.level ?? 1)
			}));
		}
		state.combatVersion = 2;
	}
	if ((state.combatVersion ?? 0) < 3) {
		const battle = state.battle;
		if (battle) {
			battle.maxHp = Math.floor(battle.maxHp * 1.5);
			battle.hp = Math.min(battle.maxHp, Math.floor(battle.hp * 1.5));
		}
		state.combatVersion = 3;
	}

	if ((state.combatVersion ?? 0) < 4) {
		const battle = state.battle;
		if (battle?.boss) {
			battle.maxHp *= 2;
			battle.hp *= 2;
		}
		state.combatVersion = 4;
	}
	if ((state.combatVersion ?? 0) < COMBAT_VERSION) {
		const battle = state.battle;
		if (battle) {
			const maxHp = monsterStats(battle.level ?? 10, battle.boss).maxHp;
			battle.hp = Math.min(maxHp, Math.ceil((battle.hp / battle.maxHp) * maxHp));
			battle.maxHp = maxHp;
		}
		state.combatVersion = COMBAT_VERSION;
	}

	const hasUpgradeCounters = Number.isSafeInteger(state.attackUpgrades);
	const historicalWeaponUpgrades =
		nonnegativeInteger(hasUpgradeCounters ? state.attackUpgrades : state.weapon) +
		(hasUpgradeCounters
			? nonnegativeInteger(state.incomeUpgrades) +
				nonnegativeInteger(state.comboUpgrades) +
				nonnegativeInteger((state as GameState & { criticalUpgrades?: number }).criticalUpgrades)
			: 0);
	const successfulUpgradeCount = Number.isSafeInteger(state.successfulUpgradeCount)
		? nonnegativeInteger(state.successfulUpgradeCount)
		: historicalWeaponUpgrades +
			nonnegativeInteger(state.armor?.maxHpUpgrades) +
			nonnegativeInteger(state.armor?.killRecoveryUpgrades) +
			nonnegativeInteger(state.armor?.defenseUpgrades);
	const normalizedState = {
		...state,
		silver: state.silver ?? 0,
		hitGold: state.hitGold ?? 1,
		incomeUpgrades: state.incomeUpgrades ?? 0,
		chargeVersion: 1,
		successRate: state.chargeVersion === 1 ? (state.successRate ?? 0) : 0,
		chanceUpgrades: state.chargeVersion === 1 ? (state.chanceUpgrades ?? 0) : 0,
		attackUpgrades: state.attackUpgrades ?? state.weapon,
		comboUpgrades: state.comboUpgrades ?? 0,
		comboRate: Math.min(COMBO_RATE_CAP, state.comboRate ?? 0),
		comboCount: Math.max(0, Math.min(1000, Math.floor(state.comboCount ?? 0))),
		rebirthCount: nonnegativeInteger(state.rebirthCount),
		memoryShards: nonnegativeInteger(state.memoryShards),
		resourceYield: normalizeResourceRecord(state.resourceYield),
		resourceYieldUpgrades: normalizeResourceRecord(state.resourceYieldUpgrades, true),
		successfulUpgradeCount,
		iron: state.iron ?? 0,
		upgradeFailures: state.upgradeFailures ?? 0,
		attack: state.attack ?? 10 + state.weapon * 3,
		armor: { ...DEFAULT_ARMOR, ...state.armor }
	};
	return { original, state: withUpgradeRate(normalizedState, user) };
}

export function withUpgradeRate(state: GameState, user: User): GameState {
	const base = baseUpgradeChance(user.currentLevel);
	return {
		...state,
		baseSuccessRate: base,
		successRate: Math.min(100, base + Math.max(0, state.successRate - (state.baseSuccessRate ?? 0)))
	};
}

export function gameProgressView(state: GameProgressState) {
	return {
		revision: state.revision,
		gold: state.gold,
		iron: state.iron,
		stones: state.stones,
		silver: state.silver,
		hitGold: state.hitGold,
		incomeUpgrades: state.incomeUpgrades,
		weapon: state.weapon,
		attack: state.attack,
		comboRate: state.comboRate,
		comboCount: state.comboCount,
		armor: state.armor,
		successRate: state.successRate,
		baseSuccessRate: state.baseSuccessRate,
		attackUpgrades: state.attackUpgrades,
		comboUpgrades: state.comboUpgrades,
		rebirthCount: state.rebirthCount,
		memoryShards: state.memoryShards,
		resourceYield: state.resourceYield,
		resourceYieldUpgrades: state.resourceYieldUpgrades,
		successfulUpgradeCount: state.successfulUpgradeCount
	};
}
