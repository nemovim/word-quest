import type { MonsterKind } from '$lib/shared/types/journey.type';
export const WINDOW_MS = 12 * 60 * 60 * 1000;
export type UpgradeKind = 'chance' | 'attack' | 'critical' | 'income';
export function upgradeCost(level: number, kind: UpgradeKind = 'attack', chance = 0) {
	return {
		gold: kind === 'chance' ? upgradeChance(chance) + level * 2 : 0,
		silver: kind === 'income' ? 2 * level + 1 : 0,
		iron: kind === 'attack' ? 3 * (level + 1) : 0,
		stones: kind === 'critical' ? level + 1 : 0
	};
}
export function upgradeChance(rate: number): number {
	return Math.min(100, Math.max(0, rate));
}

// Uniform roll in [0, goldPerMaterial) preserves the expected fractional reward.
export function chestMaterialAmount(gold: number, goldPerMaterial: number, roll: number): number {
	return Math.floor(gold / goldPerMaterial) + (roll < gold % goldPerMaterial ? 1 : 0);
}

// One exclusive bonus per answer; basic learning rewards are always retained.
export function wordBonus(roll: number) {
	if (roll < 2) return { gold: 0, iron: 0, stones: 1 };
	if (roll < 20) return { gold: 0, iron: 1, stones: 0 };
	if (roll < 45) return { gold: 5, iron: 0, stones: 0 };
	return { gold: 0, iron: 0, stones: 0 };
}

export function dungeonIron(roll: number): number {
	return roll < 10 ? 5 : roll < 35 ? 4 : 3;
}
export function bossOrder(mistakes: number[]): number[] {
	return Array.from({ length: 40 }, (_, i) => i)
		.sort((a, b) => (mistakes[b] ?? 0) - (mistakes[a] ?? 0) || a - b)
		.slice(0, 8);
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
export function monsterStats(monsterLevel: number, boss = false) {
	const level = Number.isFinite(monsterLevel)
		? Math.min(100, Math.max(10, Math.floor(monsterLevel)))
		: 10;
	const x = level / 10 - 1;
	const growth = x / 2 + (x * x) / 18;
	return {
		level,
		maxHp: Math.floor(100 + 10 * x + 2.6 * x * x) * (boss ? 4 : 1),
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
