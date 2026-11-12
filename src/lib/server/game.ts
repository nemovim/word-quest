import { randomInt, randomUUID } from 'node:crypto';

import { error } from '@sveltejs/kit';

import type {
	BattleView,
	CombatUpdate,
	PlayerHealth,
	StudyReward
} from '$lib/shared/types/combat.type';
import type { User } from '$lib/shared/types/user.type';

import {
	GameModel,
	changedGameFields,
	createInitialGameState,
	gameProgressView,
	readGameState,
	withUpgradeRate,
	type Battle,
	type GameSnapshot,
	type GameState
} from '$lib/server/game-state';
import {
	monsterStats,
	pickMonster,
	monsterLevel,
	wordCombatAmount,
	chestMaterialAmount,
	COMBAT_PERCENT_CAP,
	NORMAL_CHEST_DROP_CHANCE,
	GOLEM_STONE_DROP_CHANCE,
	CHEST_STONE_GOLD_DIVISOR,
	CHEST_COMMON_RESOURCE_BOOST,
	WINDOW_MS,
	type ResourceYieldKind
} from '$lib/shared/utils/game.util';

function spawnMonster(level: number) {
	const kind = pickMonster(randomInt(100));
	const boss = kind === 'guardian';
	const stats = monsterStats(monsterLevel(level), boss);
	return { kind, boss, level: stats.level, hp: stats.maxHp, maxHp: stats.maxHp };
}
export const createFreshBattle = (level: number): Battle => ({
	...spawnMonster(level),
	kills: 0,
	chests: [],
	claims: [],
	opened: {}
});
function battleView(battle: Battle): BattleView {
	const { hp, maxHp, kills, boss, chests } = battle;
	return {
		hp,
		maxHp,
		kills,
		boss,
		chests,
		kind: battle.kind ?? (boss ? 'guardian' : 'slime'),
		level: battle.level ?? 10
	};
}

function combatUpdate(
	state: GameState,
	battle: Battle,
	reward: CombatUpdate['reward']
): CombatUpdate {
	return {
		revision: state.revision,
		hitGold: state.hitGold,
		comboCount: state.comboCount,
		player: state.player,
		reward,
		battle: battleView(battle),
		wallet: { gold: state.gold, iron: state.iron, stones: state.stones, silver: state.silver }
	};
}

async function mutateCombat(
	user: User,
	operation: (state: GameState, battle: Battle) => CombatUpdate['reward'],
	loaded?: GameSnapshot | null
): Promise<CombatUpdate> {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		let snapshot = attempt === 0 && loaded !== undefined ? loaded : await readGameState(user);
		if (!snapshot) {
			const original = createInitialGameState();
			const inserted = await GameModel.updateOne(
				{ _id: user._id },
				{ $setOnInsert: { state: original, lockUntil: 0 } },
				{ upsert: true }
			);
			if (!inserted.upsertedCount) continue;
			snapshot = { original, state: structuredClone(original) };
		}
		const state = withUpgradeRate(snapshot.state, user);
		recoverPlayer(state.player);
		const battle = state.battle ?? createFreshBattle(user.currentLevel);
		const cutoff = Date.now() - WINDOW_MS;
		battle.claims = battle.claims.filter((claim) => claim.at > cutoff);
		const reward = operation(state, battle);
		const revision = state.revision;
		state.battle = battle;
		state.revision += 1;
		const saved = await GameModel.updateOne(
			{ _id: user._id, 'state.revision': revision, lockUntil: { $lte: Date.now() } },
			{ $set: changedGameFields(snapshot.original, state) }
		);
		if (saved.modifiedCount === 1) return combatUpdate(state, battle, reward);
	}
	error(409, '다른 요청이 진행 중이에요. 잠시 후 다시 시도해 주세요.');
}
const emptyReward = (): StudyReward => ({ gold: 0, iron: 0, stones: 0, damage: 0, clear: null });
function applyResourceYield(state: GameState, kind: ResourceYieldKind, amount: number): number {
	const extra = amount * (state.resourceYield[kind] / 100);
	if (!Number.isFinite(extra)) error(500, '자원 획득량을 계산하지 못했어요.');
	const whole = Math.floor(extra);
	const fraction = extra - whole;
	const total = amount + whole + (fraction > 0 && randomInt(1000) < fraction * 1000 ? 1 : 0);
	if (!Number.isFinite(total)) error(500, '자원 획득량을 계산하지 못했어요.');
	return total;
}
export async function rewardStudy(
	user: User,
	key: string,
	sessionId?: string,
	loaded?: GameSnapshot
): Promise<CombatUpdate> {
	return mutateCombat(
		user,
		(state, battle) => {
			const reward: CombatUpdate['reward'] = emptyReward();
			if (sessionId) assertPlayer(state, sessionId);
			if (battle.claims.some((claim) => claim.key === `hit:${key}`)) return reward;
			battle.claims.push({ key: `hit:${key}`, at: Date.now() });
			state.comboCount = Math.min(1000, state.comboCount + 1);
			const comboRate = Math.min(COMBAT_PERCENT_CAP, state.comboCount * state.comboRate);
			const comboBonus =
				state.comboCount >= 2 && state.comboRate > 0
					? Math.max(1, Math.floor((state.attack * comboRate) / 100))
					: 0;
			reward.combo = state.comboCount >= 2 ? state.comboCount : 0;
			if (reward.combo) reward.comboBonus = comboBonus;
			reward.damage = Math.min(battle.hp, state.attack + comboBonus);
			battle.hp -= reward.damage;
			reward.gold = state.hitGold * (battle.boss ? 2 : 1);
			state.gold += reward.gold;
			if (battle.hp === 0) {
				reward.clear = battle.boss ? 'boss' : 'dungeon';
				reward.chest = false;
				if (battle.boss) {
					reward.chest = true;
					battle.chests.push({ id: randomUUID(), boss: true, level: battle.level ?? 10 });
				} else {
					switch (battle.kind ?? 'slime') {
						case 'slime':
							{
								const bonusGold = 5 + randomInt(6);
								reward.gold += bonusGold;
								state.gold += bonusGold;
							}
							break;
						case 'mushroom':
							reward.iron = 3 + randomInt(4);
							state.iron += reward.iron;
							break;
						case 'bat':
							reward.silver = 1 + randomInt(3);
							state.silver += reward.silver;
							break;
						case 'golem':
							if (randomInt(100) < GOLEM_STONE_DROP_CHANCE) {
								reward.stones = 1;
								state.stones += reward.stones;
							}
							break;
					}
					if (randomInt(100) < NORMAL_CHEST_DROP_CHANCE) {
						reward.chest = true;
						battle.chests.push({
							id: randomUUID(),
							boss: false,
							level: battle.level ?? 10
						});
					}
				}
				if (battle.boss) state.victories += 1;
				battle.kills += 1;
				const player = state.player;
				if (player && player.hp > 0 && state.armor.killRecovery > 0) {
					const restored = Math.min(state.armor.killRecovery, player.maxHp - player.hp);
					if (restored > 0) {
						player.hp += restored;
						reward.playerHealing = restored;
					}
				}
				Object.assign(battle, spawnMonster(user.currentLevel));
			}
			return reward;
		},
		loaded
	);
}
export async function healMonster(
	user: User,
	key: string,
	level = 3,
	sessionId?: string,
	loaded?: GameSnapshot
): Promise<CombatUpdate> {
	return mutateCombat(
		user,
		(state, battle) => {
			if (sessionId) assertPlayer(state, sessionId);
			const reward = { ...emptyReward(), healing: 0, playerDamage: 0, playerCritical: !!sessionId };
			if (battle.claims.some((claim) => claim.key === `pass:${key}`)) return reward;
			state.comboCount = 0;
			battle.claims.push({ key: `pass:${key}`, at: Date.now() });
			reward.healing = Math.min(wordCombatAmount(level, 3), battle.maxHp - battle.hp);
			battle.hp += reward.healing;
			if (sessionId) {
				const player = assertPlayer(state, sessionId);
				reward.playerDamage = damagePlayer(player, level, battle.boss, state.armor.defense, true);
			}
			return reward;
		},
		loaded
	);
}
const RECOVERY_MS = 10 * 60 * 1000;
function recoverPlayer(player?: PlayerHealth) {
	if (!player || player.hp <= 0) return;
	const now = Date.now();
	player.healedAt ??= now;
	if (player.hp >= player.maxHp) {
		player.healedAt = now;
		return;
	}
	const minutes = Math.max(0, Math.floor((now - player.healedAt) / 60000));
	player.hp = Math.min(player.maxHp, player.hp + minutes * 2);
	player.healedAt = player.hp === player.maxHp ? now : player.healedAt + minutes * 60000;
}
function damagePlayer(
	player: PlayerHealth,
	level: number,
	boss: boolean,
	defense: number,
	critical = false
) {
	const incoming = wordCombatAmount(level, boss ? 3 : 2) * (critical ? 2 : 1);
	const reduced = Math.max(1, Math.round(incoming * (1 - defense / 100)));
	const damage = Math.min(player.hp, reduced);
	player.hp -= damage;
	if (player.hp === 0) player.recoverAt = Date.now() + RECOVERY_MS;
	return damage;
}
function assertRecovered(state: GameState) {
	if (state.player?.hp === 0 && (state.player.recoverAt ?? 0) > Date.now()) {
		const seconds = Math.ceil((state.player.recoverAt! - Date.now()) / 1000);
		error(
			429,
			`탈진하여 회복 중이에요. ${Math.floor(seconds / 60)}분 ${seconds % 60}초 후 다시 출발할 수 있어요.`
		);
	}
}
function assertPlayer(state: GameState, sessionId: string) {
	assertRecovered(state);
	if (!state.player || state.player.id !== sessionId || state.player.hp <= 0)
		error(409, '탐험이 종료되었어요. 대시보드에서 다시 출발해 주세요.');
	return state.player;
}
export async function readExploration(user: User, sessionId: string): Promise<GameSnapshot> {
	const snapshot = await readGameState(user);
	if (!snapshot) error(409, '탐험이 종료되었어요. 대시보드에서 다시 출발해 주세요.');
	assertPlayer(snapshot.state, sessionId);
	return snapshot;
}
export async function assertExploring(user: User, sessionId: string) {
	const { state } = await readExploration(user, sessionId);
	return state.player!;
}
export async function beginExploration(user: User): Promise<CombatUpdate> {
	return mutateCombat(user, (state) => {
		assertRecovered(state);
		if (!state.player || state.player.hp <= 0)
			state.player = {
				id: randomUUID(),
				hp: state.armor.maxHp,
				maxHp: state.armor.maxHp,
				healedAt: Date.now()
			};
		return emptyReward();
	});
}
export async function refreshPlayer(user: User, sessionId: string): Promise<CombatUpdate> {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const { state, original } = await readExploration(user, sessionId);
		const player = assertPlayer(state, sessionId);
		const battle = state.battle ?? createFreshBattle(user.currentLevel);
		const previousHp = player.hp;
		const previousHealedAt = player.healedAt;
		if (player.hp < player.maxHp) recoverPlayer(player);
		if (state.battle && player.hp === previousHp && player.healedAt === previousHealedAt) {
			return combatUpdate(state, battle, emptyReward());
		}

		const revision = state.revision;
		state.battle = battle;
		state.revision += 1;
		const saved = await GameModel.updateOne(
			{ _id: user._id, 'state.revision': revision, lockUntil: { $lte: Date.now() } },
			{ $set: changedGameFields(original, state) }
		);
		if (saved.modifiedCount === 1) return combatUpdate(state, battle, emptyReward());
	}
	error(409, '다른 요청이 진행 중이에요. 잠시 후 다시 시도해 주세요.');
}
export async function hurtPlayer(
	user: User,
	sessionId: string,
	actionId: string,
	level: number,
	loaded?: GameSnapshot
): Promise<CombatUpdate> {
	return mutateCombat(
		user,
		(state, battle) => {
			const reward = { ...emptyReward(), playerDamage: 0 };
			if (battle.claims.some((c) => c.key === `hurt:${sessionId}:${actionId}`)) return reward;
			const player = assertPlayer(state, sessionId);
			state.comboCount = 0;
			reward.playerDamage = damagePlayer(player, level, battle.boss, state.armor.defense);
			battle.claims.push({ key: `hurt:${sessionId}:${actionId}`, at: Date.now() });
			return reward;
		},
		loaded
	);
}
export async function openChest(user: User, id: string): Promise<CombatUpdate> {
	return mutateCombat(user, (state, battle) => {
		// Replay the reveal on retries without rolling or paying twice.
		if (Object.hasOwn(battle.opened, id)) return battle.opened[id];
		const chest = battle.chests.find((item) => item.id === id);
		if (!chest) error(404, '이 보물상자를 찾을 수 없어요.');
		const stats = monsterStats(chest.level ?? 10);
		const baseGold = Math.floor((25 + randomInt(26)) * stats.rewardMultiplier);
		const gold = Math.floor(baseGold * CHEST_COMMON_RESOURCE_BOOST);
		const baseReward = {
			...emptyReward(),
			gold,
			iron: chestMaterialAmount(gold, 5, randomInt(5)),
			stones: chestMaterialAmount(
				baseGold,
				CHEST_STONE_GOLD_DIVISOR,
				randomInt(CHEST_STONE_GOLD_DIVISOR)
			)
		};
		const silver = chestMaterialAmount(gold, 20, randomInt(20));
		const loot = {
			...baseReward,
			gold: applyResourceYield(state, 'gold', baseReward.gold),
			iron: applyResourceYield(state, 'iron', baseReward.iron),
			stones: applyResourceYield(state, 'stones', baseReward.stones),
			silver: applyResourceYield(state, 'silver', silver)
		};
		state.silver += loot.silver;
		state.gold += loot.gold;
		state.iron += loot.iron;
		state.stones += loot.stones;
		battle.chests = battle.chests.filter((item) => item.id !== id);
		battle.opened[id] = loot;
		return loot;
	});
}

export async function loadGame(user: User) {
	let snapshot = await readGameState(user);
	let state = snapshot?.state ?? withUpgradeRate(createInitialGameState(), user);
	if (
		!state.battle ||
		(state.player &&
			state.player.hp > 0 &&
			(state.player.healedAt == null ||
				(state.player.hp < state.player.maxHp && Date.now() - state.player.healedAt >= 60000)))
	) {
		await mutateCombat(user, () => emptyReward(), snapshot);
		snapshot = await readGameState(user);
		state = snapshot?.state ?? withUpgradeRate(createInitialGameState(), user);
	}
	return {
		...state,
		hitGold: state.hitGold,
		battle: battleView(state.battle ?? createFreshBattle(user.currentLevel)),
		serverNow: Date.now()
	};
}

export async function loadGameView(user: User) {
	const game = await loadGame(user);
	return {
		...gameProgressView(game),
		player: game.player,
		serverNow: game.serverNow,
		battle: game.battle
	};
}
