export type Journey = {
	startedAt: number;
	solved: number;
	bossHp: number;
	cleared: boolean;
	claims: { key: string; at: number }[];
};

export type StudyReward = {
	silver?: number;
	gold: number;
	iron: number;
	stones: number;
	damage: number;
	critical?: boolean;
	playerCritical?: boolean;
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
export type CombatUpdate = {
	hitGold?: number;
	player?: PlayerHealth;
	revision: number;
	reward: StudyReward & { healing?: number; playerDamage?: number };
	battle: BattleView;
	wallet: { gold: number; iron: number; stones: number; silver?: number };
};
