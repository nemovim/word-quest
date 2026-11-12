export type StudyReward = {
	silver?: number;
	gold: number;
	iron: number;
	stones: number;
	damage: number;
	combo?: number;
	comboBonus?: number;
	playerCritical?: boolean;
	chest?: boolean;
	clear: 'dungeon' | 'boss' | null;
};

export type Chest = { id: string; boss: boolean; level?: number };
export type MonsterKind = 'slime' | 'mushroom' | 'bat' | 'golem' | 'guardian';
export type BattleView = {
	kind?: MonsterKind;
	level?: number;
	hp: number;
	maxHp: number;
	kills: number;
	boss: boolean;
	chests: Chest[];
};
export type PlayerHealth = {
	id: string;
	hp: number;
	maxHp: number;
	recoverAt?: number;
	healedAt?: number;
};
export type ArmorStats = {
	maxHp: number;
	maxHpUpgrades: number;
	killRecovery: number;
	killRecoveryUpgrades: number;
	defense: number;
	defenseUpgrades: number;
};
export type CombatUpdate = {
	hitGold?: number;
	comboCount?: number;
	player?: PlayerHealth;
	revision: number;
	reward: StudyReward & { healing?: number; playerDamage?: number; playerHealing?: number };
	battle: BattleView;
	wallet: { gold: number; iron: number; stones: number; silver?: number };
};
