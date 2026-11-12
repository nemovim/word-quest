import type { MonsterKind } from '$lib/shared/types/combat.type';
export const WINDOW_MS = 12 * 60 * 60 * 1000;
export const COMBAT_PERCENT_CAP = 50;
export const COMBO_RATE_CAP = 15;
export const NORMAL_CHEST_DROP_CHANCE = 5;
export const GOLEM_STONE_DROP_CHANCE = 25;
export const CHEST_STONE_GOLD_DIVISOR = 30;
export const CHEST_COMMON_RESOURCE_BOOST = 1.3;
export const RESOURCE_YIELD_UPGRADE_GAINS = { min: 5, max: 15, scale: 10 };
export const RESOURCE_YIELD_UPGRADE_COST = (level: number) => level + 1;
export const REBIRTH_BASE_COST = { gold: 1000, iron: 100, silver: 50, stones: 5 };
export const RESOURCE_YIELD_KINDS = ['gold', 'iron', 'silver', 'stones'] as const;
export type ResourceYieldKind = (typeof RESOURCE_YIELD_KINDS)[number];
export const RESOURCE_YIELD_NAMES: Record<ResourceYieldKind, string> = {
	gold: '골드',
	iron: '철',
	silver: '은',
	stones: '강화석'
};
export function isResourceYieldKind(value: unknown): value is ResourceYieldKind {
	return typeof value === 'string' && RESOURCE_YIELD_KINDS.some((kind) => kind === value);
}
export function successfulUpgradeLimit(rebirthCount: number): number {
	return 10 + Math.max(0, Math.floor(Number.isFinite(rebirthCount) ? rebirthCount : 0));
}
export function vocabularyUpgradeLimit(currentLevel: number): number {
	return Math.max(0, Math.floor(Number.isFinite(currentLevel) ? currentLevel * 10 : 0));
}
export function availableUpgradeLimit(currentLevel: number, rebirthCount: number): number {
	return Math.min(successfulUpgradeLimit(rebirthCount), vocabularyUpgradeLimit(currentLevel));
}
const chanceGain = { min: 2, max: 6, scale: 1 };
const attackGain = { min: 1, max: 4, scale: 1 };
const incomeGain = { min: 1, max: 3, scale: 1 };
const comboGain = { min: 5, max: 15, scale: 10 };
export const UPGRADE_GAINS = {
	chance: chanceGain,
	attack: attackGain,
	income: incomeGain,
	combo: comboGain,
	maxHp: chanceGain,
	killRecovery: incomeGain,
	defense: comboGain
};
export type UpgradeKind = keyof typeof UPGRADE_GAINS;

export function isUpgradeKind(value: unknown): value is UpgradeKind {
	return typeof value === 'string' && Object.hasOwn(UPGRADE_GAINS, value);
}

export function upgradeCost(level: number, kind: UpgradeKind = 'attack', chance = 0) {
	return {
		gold: kind === 'chance' ? chance + level * 2 : 0,
		silver: kind === 'income' || kind === 'killRecovery' ? 2 * level + 1 : 0,
		iron: kind === 'attack' ? 3 * (level + 1) : kind === 'maxHp' ? level + 1 : 0,
		stones: kind === 'combo' || kind === 'defense' ? level + 1 : 0
	};
}
export function upgradeChance(rate: number, kind: UpgradeKind): number {
	if (kind === 'chance') return 100;
	return Math.min(100, Math.max(0, rate));
}

export function rebirthCost(nextRebirth: number) {
	return {
		gold: REBIRTH_BASE_COST.gold * nextRebirth,
		iron: REBIRTH_BASE_COST.iron * nextRebirth,
		silver: REBIRTH_BASE_COST.silver * nextRebirth,
		stones: REBIRTH_BASE_COST.stones * nextRebirth
	};
}

// Uniform roll in [0, goldPerMaterial) preserves the expected fractional reward.
export function chestMaterialAmount(gold: number, goldPerMaterial: number, roll: number): number {
	return Math.floor(gold / goldPerMaterial) + (roll < gold % goldPerMaterial ? 1 : 0);
}

// Integer monster levels 10–100 correspond to vocabulary levels 1–10.
export function monsterLevel(vocabularyLevel: number): number {
	return Math.floor(
		(Number.isFinite(vocabularyLevel) ? Math.min(10, Math.max(1, vocabularyLevel)) : 1) * 10
	);
}
export function wordCombatAmount(level: number, multiplier: number): number {
	return Math.floor(Math.min(10, Math.max(1, Number.isFinite(level) ? level : 1)) * multiplier);
}
// Fit one curve to 100 HP at Lv.10, 200 at Lv.20, and 3,000 at Lv.100.
const MONSTER_HP_EXPONENT = Math.log(29) / Math.log(9);

export function monsterStats(monsterLevel: number, boss = false) {
	const level = Number.isFinite(monsterLevel)
		? Math.min(100, Math.max(10, Math.floor(monsterLevel)))
		: 10;
	const x = level / 10 - 1;
	const growth = x / 2 + (x * x) / 18;
	const levelProgress = (level - 10) / 90;
	const maxHp = 100 + Math.round(2900 * levelProgress ** MONSTER_HP_EXPONENT);
	return {
		level,
		maxHp: maxHp * (boss ? 4 : 1),
		rewardMultiplier: 1 + growth * 0.2
	};
}

export const MONSTER_NAMES: Record<MonsterKind, string> = {
	slime: '꿀빛 슬라임',
	mushroom: '밤송이 버섯',
	bat: '동굴 박쥐',
	golem: '조약돌 골렘',
	guardian: '고대 수호자'
};
export const BOSS_CHANCE = 10;
export function pickMonster(roll: number): MonsterKind {
	if (roll < BOSS_CHANCE) return 'guardian';
	return (['slime', 'mushroom', 'bat', 'golem'] as const)[
		Math.min(3, Math.floor(((roll - BOSS_CHANCE) * 4) / (100 - BOSS_CHANCE)))
	];
}

export function baseUpgradeChance(vocabularyLevel: number): number {
	return Math.min(
		100,
		Math.max(0, Math.floor((Number.isFinite(vocabularyLevel) ? vocabularyLevel : 1) * 10))
	);
}
