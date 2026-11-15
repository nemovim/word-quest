/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { User } from '$lib/shared/types/user.type';

import {
	beginExploration,
	refreshPlayer,
	hurtPlayer,
	assertExploring,
	readExploration,
	loadGame,
	rewardStudy,
	handlePass,
	openChest
} from '$lib/server/game';
import { actGame } from '$lib/server/game-actions';
import {
	pickMonster,
	monsterLevel,
	monsterStats,
	baseUpgradeChance,
	upgradeChance,
	upgradeCost,
	chestMaterialAmount,
	COMBO_RATE_CAP,
	RESOURCE_YIELD_UPGRADE_COST,
	rebirthCost,
	GOLEM_STONE_DROP_CHANCE,
	NORMAL_CHEST_DROP_CHANCE,
	CHEST_STONE_GOLD_DIVISOR,
	UPGRADE_GAINS,
	availableUpgradeLimit,
	vocabularyUpgradeLimit
} from '$lib/shared/utils/game.util';

const roll = vi.hoisted(() => vi.fn((max: number) => max - 1));
vi.mock('node:crypto', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:crypto')>()),
	randomInt: roll
}));

const user = { _id: 'player', currentLevel: 1 } as User;
const model = mongoose.model('Game');
let stored: any;
async function action(action: string, answer = 'word', kind = 'attack', resource?: string) {
	return actionAs(user, action, answer, kind, resource);
}
async function actionAs(
	actor: User,
	action: string,
	answer = 'word',
	kind = 'attack',
	resource?: string
) {
	const form = new FormData();
	form.set('revision', String(stored?.state.revision ?? 0));
	form.set('action', action);
	form.set('kind', kind);
	form.set('answer', answer);
	if (resource) form.set('resource', resource);
	return actGame(actor, form);
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	roll.mockReset().mockImplementation((max) => max - 1);
	stored = undefined;
	vi.spyOn(model, 'findById').mockImplementation(
		() => ({ lean: async () => structuredClone(stored ?? null) }) as any
	);
	vi.spyOn(model, 'updateOne').mockImplementation((async (filter: any, update: any) => {
		if (update.$setOnInsert) {
			const upsertedCount = stored == null ? 1 : 0;
			stored ??= { _id: 'player', ...structuredClone(update.$setOnInsert) };
			return { modifiedCount: 0, upsertedCount };
		}
		if (
			filter['state.revision'] !== undefined &&
			filter['state.revision'] !== stored.state.revision
		)
			return { modifiedCount: 0 };
		if (filter.lockUntil?.$lte !== undefined && stored.lockUntil > filter.lockUntil.$lte)
			return { modifiedCount: 0 };
		for (const [path, value] of Object.entries(update.$set)) {
			const keys = path.split('.');
			const last = keys.pop()!;
			const parent = keys.reduce((object, key) => (object[key] ??= {}), stored);
			parent[last] = structuredClone(value);
		}
		return { modifiedCount: 1 };
	}) as any);
});

describe('game progression', () => {
	it('rejects removed exploration actions', async () => {
		await loadGame(user);
		for (const actionName of ['start', 'answer', 'hint']) {
			await expect(action(actionName)).rejects.toMatchObject({ status: 400 });
		}
	});

	it('requires both vocabulary level and rebirth progression for upgrades and rebirth', async () => {
		expect(vocabularyUpgradeLimit(0)).toBe(0);
		expect(vocabularyUpgradeLimit(0.5)).toBe(5);
		expect(vocabularyUpgradeLimit(1)).toBe(10);
		expect(vocabularyUpgradeLimit(1.09)).toBe(10);
		expect(vocabularyUpgradeLimit(1.1)).toBe(11);
		expect(availableUpgradeLimit(0.5, 0)).toBe(5);
		expect(availableUpgradeLimit(1.19, 1)).toBe(11);
		expect(availableUpgradeLimit(1.3, 0)).toBe(10);
		expect(availableUpgradeLimit(1.3, 1)).toBe(11);
		expect(availableUpgradeLimit(1.3, 3)).toBe(13);
		expect(availableUpgradeLimit(1.3, 4)).toBe(13);

		await loadGame(user);
		await rewardStudy(user, 'initialize-level-gate');
		await expect(actionAs({ ...user, currentLevel: 0 }, 'upgrade')).rejects.toMatchObject({
			status: 400
		});
		await expect(actionAs({ ...user, currentLevel: 0 }, 'rebirth')).rejects.toMatchObject({
			status: 400
		});
		const level13 = { ...user, currentLevel: 1.3 };
		Object.assign(stored.state, {
			successfulUpgradeCount: 10,
			gold: 25000,
			iron: 1500,
			silver: 500,
			stones: 50
		});
		await expect(actionAs(level13, 'upgrade')).rejects.toMatchObject({ status: 400 });
		await actionAs(level13, 'upgrade', 'word', 'chance');
		expect(stored.state.successfulUpgradeCount).toBe(10);
		await expect(actionAs({ ...user, currentLevel: 0.9 }, 'rebirth')).rejects.toMatchObject({
			status: 400
		});
		expect((await actionAs(level13, 'rebirth')).message).toContain('환생 1회 완료');
		Object.assign(stored.state, {
			rebirthCount: 3,
			successfulUpgradeCount: 13,
			gold: 25000,
			iron: 1500,
			silver: 500,
			stones: 50
		});
		expect((await actionAs(level13, 'rebirth')).message).toContain('환생 4회 완료');
		Object.assign(stored.state, {
			successfulUpgradeCount: 13,
			gold: 25000,
			iron: 1500,
			silver: 500,
			stones: 50
		});
		await expect(actionAs(level13, 'rebirth')).rejects.toMatchObject({ status: 400 });
		await expect(actionAs({ ...user, currentLevel: 1.4 }, 'rebirth')).rejects.toMatchObject({
			status: 400
		});
		stored.state.successfulUpgradeCount = 14;
		expect((await actionAs({ ...user, currentLevel: 1.4 }, 'rebirth')).message).toContain(
			'환생 5회 완료'
		);
	});

	it('upgrades a chosen resource yield for increasing shard costs', async () => {
		await loadGame(user);
		Object.assign(stored.state, {
			memoryShards: 5,
			resourceYield: { gold: 0, iron: 0, silver: 0, stones: 0 },
			resourceYieldUpgrades: { gold: 0, iron: 0, silver: 0, stones: 0 }
		});

		const first = await action('memory-upgrade', 'word', 'attack', 'iron');
		expect(first.game).toMatchObject({
			memoryShards: 4,
			resourceYield: { iron: 1.5 },
			resourceYieldUpgrades: { iron: 1 }
		});
		const second = await action('memory-upgrade', 'word', 'attack', 'iron');
		expect(second.game).toMatchObject({
			memoryShards: 2,
			resourceYield: { iron: 3 },
			resourceYieldUpgrades: { iron: 2 }
		});
		expect(RESOURCE_YIELD_UPGRADE_COST(0)).toBe(1);
		expect(RESOURCE_YIELD_UPGRADE_COST(2)).toBe(3);
		await expect(action('memory-upgrade', 'word', 'attack', 'invalid')).rejects.toMatchObject({
			status: 400
		});
		expect(stored.state.memoryShards).toBe(2);
	});

	it('refunds retired base upgrades once and raises the base on rebirth', async () => {
		await loadGame(user);
		Object.assign(stored.state, {
			memoryShards: 1,
			baseSuccessUpgrades: 2,
			baseSuccessRate: 12,
			successRate: 17
		});
		const view = await loadGame(user);
		expect(view).toMatchObject({ memoryShards: 4, baseSuccessRate: 0, successRate: 5 });
		await action('memory-upgrade', 'word', 'attack', 'iron');
		expect(stored.state).toMatchObject({ memoryShards: 3, baseSuccessUpgrades: 0 });
		expect((await loadGame(user)).memoryShards).toBe(3);
		Object.assign(stored.state, {
			successfulUpgradeCount: 10,
			gold: 5000,
			iron: 300,
			silver: 100,
			stones: 10
		});
		await action('rebirth');
		expect(stored.state).toMatchObject({ rebirthCount: 1, baseSuccessRate: 1, successRate: 1 });
	});

	it('limits successful upgrades and resets the run while preserving permanent progress', async () => {
		await loadGame(user);
		await rewardStudy(user, 'initialize-rebirth');
		stored.state.iron = 1000;
		for (let i = 0; i < 10; i++) {
			stored.state.successRate = 100;
			await action('upgrade');
		}
		expect(stored.state.successfulUpgradeCount).toBe(10);
		await expect(action('upgrade')).rejects.toMatchObject({ status: 400 });

		Object.assign(stored.state, {
			gold: 5000,
			iron: 300,
			silver: 100,
			stones: 10,
			memoryShards: 3,
			resourceYield: { gold: 12.5, iron: 2, silver: 3, stones: 4 },
			resourceYieldUpgrades: { gold: 2, iron: 1, silver: 0, stones: 3 }
		});
		stored.state.battle.chests = [{ id: 'rebirth-chest', boss: false, level: 10 }];
		expect(rebirthCost(1)).toEqual({ gold: 1000, iron: 200, silver: 50, stones: 10 });
		expect(rebirthCost(2)).toEqual({ gold: 2000, iron: 400, silver: 100, stones: 20 });

		const result = await action('rebirth');
		expect(result.message).toContain('환생 1회 완료');
		expect(stored.state).toMatchObject({
			rebirthCount: 1,
			memoryShards: 4,
			gold: 0,
			iron: 0,
			silver: 0,
			stones: 0,
			weapon: 0,
			attack: 10,
			attackUpgrades: 0,
			successfulUpgradeCount: 0,
			resourceYield: { gold: 12.5, iron: 2, silver: 3, stones: 4 },
			resourceYieldUpgrades: { gold: 2, iron: 1, silver: 0, stones: 3 }
		});
		expect(stored.state.battle.chests).toHaveLength(0);
		expect(stored.lockUntil).toBe(0);
	});

	it('applies resource yields to chest contents without boosting hit gold', async () => {
		await rewardStudy(user, 'initialize-yields');
		Object.assign(stored.state, {
			resourceYield: { gold: 10, iron: 100, silver: 100, stones: 100 },
			battle: {
				...stored.state.battle,
				chests: [{ id: 'yield-chest', boss: false, level: 10 }]
			}
		});
		expect((await rewardStudy(user, 'yield-hit')).reward.gold).toBe(1);

		const chest = await openChest(user, 'yield-chest');
		expect(chest.reward).toMatchObject({ gold: 182, iron: 66, silver: 16, stones: 2 });
	});

	it('boosts each monster kill reward but keeps hit gold unchanged', async () => {
		await loadGame(user);
		stored.state.resourceYield = { gold: 100, iron: 100, silver: 100, stones: 100 };
		stored.state.battle.kind = 'slime';
		stored.state.battle.hp = 100;
		expect((await rewardStudy(user, 'plain-hit')).reward.gold).toBe(1);
		stored.state.battle.hp = 1;
		expect((await rewardStudy(user, 'slime-boost')).reward.gold).toBe(101);
		stored.state.battle.kind = 'mushroom';
		stored.state.battle.hp = 1;
		expect((await rewardStudy(user, 'mushroom-boost')).reward.iron).toBe(20);
		stored.state.battle.kind = 'bat';
		stored.state.battle.hp = 1;
		expect((await rewardStudy(user, 'bat-boost')).reward.silver).toBe(6);
		stored.state.battle.kind = 'golem';
		stored.state.battle.hp = 1;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(99);
		expect((await rewardStudy(user, 'golem-boost')).reward.stones).toBe(2);
	});

	it('scales kill rewards using the defeated monster level and preserves fractional rewards', async () => {
		await loadGame(user);
		stored.state.resourceYield = { gold: 0, iron: 0, silver: 0, stones: 100 };
		Object.assign(stored.state.battle, { level: 100, kind: 'slime', hp: 1 });
		expect((await rewardStudy(user, 'high-slime')).reward.gold).toBe(186);
		Object.assign(stored.state.battle, { level: 100, kind: 'golem', hp: 1 });
		roll.mockReturnValueOnce(0).mockReturnValueOnce(0);
		const drop = await rewardStudy(user, 'high-golem');
		expect(drop.reward.stones).toBe(8);
		expect((await rewardStudy(user, 'high-golem')).reward.stones).toBe(0);
	});

	it('pays a scaled boss kill reward once alongside hit gold and a chest', async () => {
		await loadGame(user);
		stored.state.resourceYield = { gold: 100, iron: 100, silver: 100, stones: 100 };
		Object.assign(stored.state.battle, { level: 100, kind: 'guardian', boss: true, hp: 1 });
		roll.mockImplementation(() => 0);
		const result = await rewardStudy(user, 'boss-scaled');
		expect(result.reward).toMatchObject({
			gold: 224,
			iron: 45,
			silver: 8,
			stones: 8,
			chest: true
		});
		const duplicate = await rewardStudy(user, 'boss-scaled');
		expect(duplicate.reward).toMatchObject({ gold: 0, iron: 0, stones: 0 });
	});

	it.each([
		[39, 1],
		[40, 0]
	])(
		'uses the golem stone drop chance for bosses at roll %i',
		async (stoneRoll, expectedStones) => {
			await loadGame(user);
			Object.assign(stored.state.battle, { level: 10, kind: 'guardian', boss: true, hp: 1 });
			roll
				.mockReturnValueOnce(0)
				.mockReturnValueOnce(0)
				.mockReturnValueOnce(0)
				.mockReturnValueOnce(stoneRoll);
			const result = await rewardStudy(user, `boss-stone-${stoneRoll}`);
			expect(result.reward).toMatchObject({
				gold: 32,
				iron: 6,
				silver: 1,
				stones: expectedStones,
				chest: true
			});
		}
	);

	it('reuses the checked combat state and saves only changed fields', async () => {
		const started = await beginExploration(user);
		const sessionId = started.player!.id;
		const checked = await readExploration(user, sessionId);
		vi.mocked(model.findById).mockClear();
		vi.mocked(model.updateOne).mockClear();

		const reward = await rewardStudy(user, 'once', sessionId, checked);

		expect(reward.reward.damage).toBeGreaterThan(0);
		expect(model.findById).not.toHaveBeenCalled();
		expect(model.updateOne).toHaveBeenCalledOnce();
		const update = vi.mocked(model.updateOne).mock.calls[0][1];
		expect(update).toMatchObject({ $set: { 'state.battle.hp': reward.battle.hp } });
		expect(update).not.toHaveProperty('$set.state');
	});
	it('loads legacy saves with zero iron and preserves existing materials', async () => {
		await loadGame(user);
		delete stored.state.iron;
		delete stored.state.upgradeFailures;
		stored.state.stones = 7;
		const view = await loadGame(user);
		expect(view.iron).toBe(0);
		expect(view.upgradeFailures).toBe(0);
		expect(view.stones).toBe(7);
		await rewardStudy(user, 'legacy-material-check');
		expect(stored.state.iron).toBe(0);
		expect(stored.state.stones).toBe(7);
	});
	it('uses only the selected resource and rejects missing materials', async () => {
		expect(UPGRADE_GAINS.attack).toEqual({ min: 2, max: 6, scale: 1 });
		expect(UPGRADE_GAINS.chance).toEqual({ min: 4, max: 12, scale: 1 });
		expect(UPGRADE_GAINS.maxHp).toEqual({ min: 2, max: 6, scale: 1 });
		await loadGame(user);
		Object.assign(stored.state, { gold: 200, iron: 20, stones: 0, successRate: 70 });
		await expect(action('upgrade', 'word', 'combo')).rejects.toMatchObject({ status: 400 });
		expect(stored.state).toMatchObject({ gold: 200, iron: 20, stones: 0 });
		roll.mockReturnValueOnce(0);
		await action('upgrade');
		expect(stored.state).toMatchObject({
			gold: 200,
			iron: 17,
			stones: 0,
			comboRate: 0,
			weapon: 1
		});
		expect(upgradeCost(5, 'attack')).toEqual({ silver: 0, gold: 0, iron: 18, stones: 0 });
		expect(upgradeCost(5, 'combo')).toEqual({ silver: 0, gold: 0, iron: 0, stones: 6 });
	});
});

describe('random rewards and upgrade protection', () => {
	it('reports upgrade outcomes without treating costs as loot', async () => {
		await loadGame(user);
		Object.assign(stored.state, { gold: 200, iron: 20, successRate: 70 });
		const failure = await action('upgrade');
		expect(failure.effect).toMatchObject({
			kind: 'upgrade-failure',
			gold: 0,
			iron: 0,
			stones: 0,
			damage: 0
		});
		roll.mockReturnValueOnce(0);
		const success = await action('upgrade');
		expect(success.effect).toMatchObject({
			kind: 'upgrade-success',
			gold: 0,
			iron: 0,
			stones: 0,
			damage: 0
		});
	});
	it('bounds upgrade odds', () => {
		expect(upgradeChance(70, 'attack')).toBe(70);
		expect(upgradeChance(-1, 'attack')).toBe(0);
		expect(upgradeChance(120, 'attack')).toBe(100);
	});
	it('never changes success rate or other resources after repeated failures', async () => {
		await loadGame(user);
		Object.assign(stored.state, {
			gold: 500,
			iron: 50,
			stones: 3,
			upgradeFailures: 9,
			successRate: 70
		});
		for (let i = 0; i < 3; i++) await action('upgrade');
		expect(stored.state).toMatchObject({
			gold: 500,
			iron: 41,
			stones: 3,
			successRate: 70,
			attack: 10,
			comboRate: 0,
			weapon: 0
		});
		await action('upgrade', 'word', 'combo');
		expect(stored.state).toMatchObject({
			gold: 500,
			iron: 41,
			stones: 2,
			successRate: 70,
			attack: 10,
			comboRate: 0
		});
	});
	it('uses the fixed base, retains charges on failure and resets after either successful upgrade', async () => {
		await loadGame(user);
		Object.assign(stored.state, { gold: 10000, iron: 20, stones: 3 });
		expect(stored.state.successRate).toBe(0);
		const calls = roll.mock.calls.length;
		roll.mockReturnValueOnce(3);
		await action('upgrade', 'word', 'chance');
		expect(roll.mock.calls.length).toBe(calls + 1);
		expect(roll).toHaveBeenLastCalledWith(9);
		expect(stored.state).toMatchObject({ gold: 10000, iron: 20, stones: 3, successRate: 7 });
		roll.mockReturnValueOnce(7);
		await action('upgrade');
		expect(stored.state).toMatchObject({ iron: 17, successRate: 7, attack: 10 });
		roll.mockReturnValueOnce(6).mockReturnValueOnce(0);
		await action('upgrade');
		expect(stored.state).toMatchObject({ iron: 14, successRate: 0, attack: 12, weapon: 1 });
		roll.mockReturnValueOnce(3);
		await action('upgrade', 'word', 'chance');
		expect(stored.state).toMatchObject({ gold: 9998, successRate: 7 });
		roll.mockReturnValueOnce(0).mockReturnValueOnce(0);
		await action('upgrade', 'word', 'combo');
		expect(stored.state).toMatchObject({
			stones: 2,
			successRate: 0,
			comboRate: 1,
			comboUpgrades: 1,
			weapon: 2
		});
		stored.state.successRate = 98;
		await action('upgrade', 'word', 'chance');
		expect(stored.state.successRate).toBe(100);
		const gold = stored.state.gold;
		await expect(action('upgrade', 'word', 'chance')).rejects.toMatchObject({ status: 400 });
		expect(stored.state.gold).toBe(gold);
	});
	it('keeps the base at 0 and preserves charged points when the level changes', async () => {
		expect(baseUpgradeChance(2.34)).toBe(0);
		expect(baseUpgradeChance(2.3)).toBe(0);
		expect(baseUpgradeChance(10)).toBe(0);
		const advanced = { ...user, currentLevel: 2.34 };
		await beginExploration(advanced);
		expect((await loadGame(advanced)).successRate).toBe(0);
		stored.state.successRate = 20;
		const higher = { ...user, currentLevel: 3.01 };
		expect(await loadGame(higher)).toMatchObject({ baseSuccessRate: 0, successRate: 20 });
		expect(await loadGame(higher)).toMatchObject({ baseSuccessRate: 0, successRate: 20 });
		expect(await loadGame({ ...user, currentLevel: 1.01 })).toMatchObject({
			baseSuccessRate: 0,
			successRate: 20
		});
		Object.assign(stored.state, { iron: 10 });
		const form = new FormData();
		form.set('action', 'upgrade');
		form.set('kind', 'attack');
		form.set('revision', String(stored.state.revision));
		roll.mockReturnValueOnce(0).mockReturnValueOnce(0);
		await actGame(higher, form);
		expect(stored.state).toMatchObject({ baseSuccessRate: 0, successRate: 0 });
	});
	it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
		'charges by a random 4–12 points without increasing equipment upgrades for roll %i',
		async (value) => {
			await loadGame(user);
			stored.state.gold = 10000;
			roll.mockReturnValueOnce(value);
			await action('upgrade', 'word', 'chance');
			expect(stored.state.successRate).toBe(4 + value);
			expect(stored.state).toMatchObject({
				weapon: 0,
				attackUpgrades: 0,
				comboUpgrades: 0,
				incomeUpgrades: 0
			});
		}
	);
	it('increases charging cost with both current probability and weapon level', () => {
		expect(upgradeCost(0, 'chance', 0).gold).toBe(0);
		expect(upgradeCost(0, 'chance', 50).gold).toBe(50);
		expect(upgradeCost(5, 'chance', 50).gold).toBe(60);
		for (let rate = 0; rate < 95; rate += 5)
			expect(upgradeCost(2, 'chance', rate + 5).gold).toBeGreaterThan(
				upgradeCost(2, 'chance', rate).gold
			);
	});
	it('migrates legacy upgrades without retaining the failure bonus', async () => {
		await loadGame(user);
		Object.assign(stored.state, { weapon: 4, attack: 29, criticalChance: 12, upgradeFailures: 9 });
		for (const key of [
			'chargeVersion',
			'successRate',
			'chanceUpgrades',
			'attackUpgrades',
			'criticalUpgrades',
			'comboRate',
			'comboUpgrades'
		])
			delete stored.state[key];
		expect(await loadGame(user)).toMatchObject({
			attack: 29,
			comboRate: 0,
			successRate: 0,
			attackUpgrades: 4,
			comboUpgrades: 0,
			chanceUpgrades: 0
		});
	});
});

describe('persistent monster and treasure chests', () => {
	it('doubles hit income only against bosses while exposing base income in dashboard and combat', async () => {
		await beginExploration(user);
		stored.state.hitGold = 5;
		expect((await loadGame(user)).hitGold).toBe(5);
		const normal = await rewardStudy(user, 'normal-income');
		expect(normal.reward.gold).toBe(5);
		expect(normal.hitGold).toBe(5);
		Object.assign(stored.state.battle, { boss: true, hp: 1 });
		const boss = await rewardStudy(user, 'boss-income');
		expect(boss.reward).toMatchObject({ gold: 60, iron: 10, silver: 3, stones: 0, chest: true });
		expect(boss.reward.clear).toBe('boss');
		expect(boss.hitGold).toBe(5);
		expect((await loadGame(user)).hitGold).toBe(5);
	});
	it('adds combo damage from the second consecutive correct answer and never rerolls duplicates', async () => {
		await beginExploration(user);
		stored.state.comboRate = 10;
		expect((await rewardStudy(user, 'first')).reward).toMatchObject({ damage: 10, combo: 0 });
		expect((await rewardStudy(user, 'second')).reward).toMatchObject({
			damage: 12,
			combo: 2,
			comboBonus: 2
		});
		expect((await rewardStudy(user, 'third')).reward).toMatchObject({
			damage: 13,
			combo: 3,
			comboBonus: 3
		});
		const count = stored.state.comboCount;
		expect((await rewardStudy(user, 'third')).reward.damage).toBe(0);
		expect(stored.state.comboCount).toBe(count);
		expect((await rewardStudy(user, 'fourth')).reward).toMatchObject({ damage: 14, combo: 4 });
	});
	it('pays monster-specific resources and rarely drops non-boss chests', async () => {
		await loadGame(user);
		stored.state.battle.hp = 1;
		stored.state.battle.kind = 'slime';
		const slime = await rewardStudy(user, 'slime-kill');
		expect(slime.reward).toMatchObject({ clear: 'dungeon', gold: 51, chest: false });
		expect(slime.battle.chests).toHaveLength(0);

		stored.state.battle.hp = 1;
		stored.state.battle.kind = 'mushroom';
		const mushroom = await rewardStudy(user, 'mushroom-kill');
		expect(mushroom.reward.iron).toBe(10);

		stored.state.battle.hp = 1;
		stored.state.battle.kind = 'bat';
		const bat = await rewardStudy(user, 'bat-kill');
		expect(bat.reward.silver).toBe(3);

		stored.state.battle.hp = 1;
		stored.state.battle.kind = 'golem';
		const golem = await rewardStudy(user, 'golem-kill');
		expect(golem.reward.stones).toBe(0);
		stored.state.battle.hp = 1;
		stored.state.battle.kind = 'golem';
		roll.mockReturnValueOnce(GOLEM_STONE_DROP_CHANCE - 1).mockReturnValueOnce(99);
		const golemDrop = await rewardStudy(user, 'golem-drop');
		expect(golemDrop.reward.stones).toBe(1);
		expect(GOLEM_STONE_DROP_CHANCE).toBe(40);
		expect(NORMAL_CHEST_DROP_CHANCE).toBe(5);

		stored.state.battle.boss = true;
		stored.state.battle.hp = 1;
		const boss = await rewardStudy(user, 'boss-chest-guaranteed');
		expect(boss.reward.chest).toBe(true);
		expect(boss.battle.chests.at(-1)?.boss).toBe(true);
	});
	it('allows combo bonus above 50% and caps damage at remaining boss health', async () => {
		await rewardStudy(user, 'init');
		Object.assign(stored.state, { comboRate: 15, comboCount: 9 });
		Object.assign(stored.state.battle, { maxHp: 1000, hp: 1000 });
		expect((await rewardStudy(user, 'bonus-cap')).reward).toMatchObject({ damage: 25, comboBonus: 15 });
		Object.assign(stored.state.battle, { boss: true, maxHp: 160, hp: 7, kills: 5 });
		stored.state.comboCount = 1;
		const result = await rewardStudy(user, 'boss-combo');
		expect(result.reward).toMatchObject({ damage: 7, combo: 2, comboBonus: 3, clear: 'boss' });
		expect(result.battle.chests[0].boss).toBe(true);
	});

	it('resets combo on pass and retains health across answers', async () => {
		const start = await beginExploration(user);
		stored.state.comboRate = 10;
		expect((await rewardStudy(user, 'a')).battle.hp).toBe(40);
		expect((await rewardStudy(user, 'b')).battle.hp).toBe(28);
		expect(stored.state.comboCount).toBe(2);
		expect((await handlePass(user, 'c')).reward.healing).toBe(9);
		expect(stored.state.comboCount).toBe(0);
		expect((await handlePass(user, 'c')).battle.hp).toBe(37);
		expect((await handlePass(user, 'd', 10)).battle.hp).toBe(50);
		expect((await loadGame(user)).battle.hp).toBe(50);
		await rewardStudy(user, 'after-pass-a');
		await rewardStudy(user, 'after-pass-b');
		expect(stored.state.comboCount).toBe(2);
		await hurtPlayer(user, start.player!.id, 'wrong-answer', 1);
		expect(stored.state.comboCount).toBe(0);
		stored.state.weapon = 10;
		stored.state.attack = 40;
		expect((await rewardStudy(user, 'e')).battle.hp).toBe(50);
		expect((await rewardStudy(user, 'e')).reward.gold).toBe(0);
	});
	it('stores a chest on death, pays only on open and replays without reroll', async () => {
		await loadGame(user);
		stored.state.battle.kind = 'slime';
		for (let i = 0; i < 12; i++) {
			if (i === 4) roll.mockReturnValueOnce(5).mockReturnValueOnce(0).mockReturnValueOnce(99);
			await rewardStudy(user, String(i));
		}
		expect(stored.state.gold).toBe(52);
		const view = await loadGame(user);
		expect(view.battle).toMatchObject({ hp: 30, kills: 2 });
		expect(view.battle.chests).toHaveLength(1);
		expect(view.battle).not.toHaveProperty('opened');
		roll.mockImplementation((max) => (max === 100 ? 0 : max - 1));
		const id = view.battle.chests[0].id;
		const opened = await openChest(user, id);
		expect(opened.reward).toMatchObject({ gold: 166, iron: 33, stones: 1 });
		expect(opened.wallet).toMatchObject({ gold: 218, iron: 33, stones: 1 });
		expect(opened.battle.chests).toHaveLength(0);
		const calls = roll.mock.calls.length;
		expect((await openChest(user, id)).wallet).toEqual(opened.wallet);
		expect(roll.mock.calls.length).toBe(calls);
		await expect(openChest(user, 'missing')).rejects.toMatchObject({ status: 404 });
		await expect(openChest(user, '__proto__')).rejects.toMatchObject({ status: 404 });
	});
	it('rolls rare bosses independently of kills and awards a boss chest', async () => {
		await beginExploration(user);
		stored.state.attack = 1000;
		for (let i = 0; i < 5; i++) await rewardStudy(user, `kill-${i}`);
		expect(stored.state.battle).toMatchObject({ boss: false, hp: 50 });
		stored.state.battle.kind = 'slime';
		roll.mockReturnValueOnce(5).mockReturnValueOnce(99).mockReturnValueOnce(4);
		const encounter = await rewardStudy(user, 'rare');
		expect(encounter.battle).toMatchObject({ boss: true, kind: 'guardian', hp: 200 });
		const slain = await rewardStudy(user, 'boss');
		expect(slain.reward).toMatchObject({ damage: 200, clear: 'boss' });
		expect(slain.battle.chests.at(-1)?.boss).toBe(true);
	});
	it('has exactly ten boss rolls and all four regular species', () => {
		const encounters = Array.from({ length: 100 }, (_, i) => pickMonster(i));
		expect(encounters.filter((k) => k === 'guardian')).toHaveLength(10);
		expect(new Set(encounters)).toEqual(new Set(['guardian', 'slime', 'mushroom', 'bat', 'golem']));
		expect(pickMonster(9)).toBe('guardian');
		expect(pickMonster(10)).toBe('slime');
	});
	it('persists the first random encounter across reloads and doubles boss retaliation', async () => {
		roll.mockReturnValueOnce(0);
		expect((await loadGame(user)).battle).toMatchObject({ boss: true, kind: 'guardian', hp: 200 });
		const calls = roll.mock.calls.length;
		expect((await loadGame(user)).battle.kind).toBe('guardian');
		expect(roll.mock.calls.length).toBe(calls);
		const start = await beginExploration(user);
		expect((await hurtPlayer(user, start.player!.id, 'wrong', 2.5)).reward.playerDamage).toBe(6);
	});
	it('upgrades an existing boss once without changing its wound ratio', async () => {
		await beginExploration(user);
		stored.state.combatVersion = 3;
		Object.assign(stored.state.battle, { boss: true, hp: 60, maxHp: 240 });
		expect((await loadGame(user)).battle).toMatchObject({ hp: 50, maxHp: 200 });
		await beginExploration(user);
		expect((await loadGame(user)).battle).toMatchObject({ hp: 50, maxHp: 200 });
	});
	it('serializes concurrent hits and chest opens without duplicate payout', async () => {
		await rewardStudy(user, 'a');
		const same = await Promise.all([rewardStudy(user, 'b'), rewardStudy(user, 'b')]);
		expect(same.reduce((sum, value) => sum + value.reward.gold, 0)).toBe(1);
		stored.state.weapon = 100;
		stored.state.attack = 310;
		stored.state.battle.kind = 'slime';
		roll.mockReturnValueOnce(5).mockReturnValueOnce(0).mockReturnValueOnce(99);
		const hit = await rewardStudy(user, 'kill');
		roll.mockImplementation((max) => max - 1);
		await Promise.all([
			openChest(user, hit.battle.chests[0].id),
			openChest(user, hit.battle.chests[0].id)
		]);
		expect(stored.state.gold).toBe(209);
		expect(stored.state.iron).toBe(33);
	});
	it('does not mutate combat while an upgrade holds the save lock', async () => {
		await rewardStudy(user, 'a');
		stored.lockUntil = Date.now() + 60000;
		await expect(rewardStudy(user, 'b')).rejects.toMatchObject({ status: 409 });
		expect(stored.state.gold).toBe(1);
	});
});

describe('random permanent weapon stats', () => {
	it.each(['combo', 'defense'] as const)(
		'rolls %s gains from 1.0 to 3.0 in 0.1 steps',
		async (kind) => {
			for (let value = 0; value <= 20; value++) {
				await beginExploration(user);
				Object.assign(stored.state, { stones: 1, successRate: 100, comboRate: 1.1 });
				stored.state.armor.defense = 1.1;
				roll.mockReturnValueOnce(0).mockReturnValueOnce(value);
				await action('upgrade', 'word', kind);
				expect(kind === 'combo' ? stored.state.comboRate : stored.state.armor.defense).toBe(
					(21 + value) / 10
				);
				expect(roll).toHaveBeenLastCalledWith(21);
				stored = undefined;
			}
		}
	);
	it('starts combo rate at zero for legacy saves without rerolling upgrades', async () => {
		await loadGame(user);
		stored.state.weapon = 7;
		delete stored.state.attack;
		delete stored.state.criticalChance;
		delete stored.state.comboRate;
		expect(await loadGame(user)).toMatchObject({ attack: 31, comboRate: 0, comboUpgrades: 0 });
		expect(await loadGame(user)).toMatchObject({ attack: 31, comboRate: 0, comboUpgrades: 0 });
	});
	it('caps combo rate and rejects capped upgrades without charging', async () => {
		expect(COMBO_RATE_CAP).toBe(30);
		await loadGame(user);
		Object.assign(stored.state, {
			gold: 1000,
			iron: 100,
			stones: 5,
			comboRate: COMBO_RATE_CAP - 0.7
		});
		stored.state.successRate = 70;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(0);
		await action('upgrade');
		expect(stored.state).toMatchObject({ attack: 12, comboRate: COMBO_RATE_CAP - 0.7 });
		stored.state.successRate = 70;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(2);
		await action('upgrade', 'word', 'combo');
		expect(stored.state).toMatchObject({ attack: 12, comboRate: COMBO_RATE_CAP, stones: 4 });
		await expect(action('upgrade', 'word', 'combo')).rejects.toMatchObject({ status: 400 });
		expect(stored.state.stones).toBe(4);
		stored.state.successRate = 70;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(3);
		await action('upgrade');
		expect(stored.state).toMatchObject({ attack: 17, comboRate: COMBO_RATE_CAP });
		await expect(action('upgrade', 'word', 'unknown')).rejects.toMatchObject({ status: 400 });
	});
});

describe('armor upgrades', () => {
	it('uses the weapon resources and gain ranges for armor without increasing weapon level', async () => {
		await beginExploration(user);
		Object.assign(stored.state, { iron: 1, silver: 1, stones: 1, comboRate: 75 });
		expect((await loadGame(user)).comboRate).toBe(COMBO_RATE_CAP);
		stored.state.armor.defense = 49.8;
		stored.state.successRate = 100;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(4);
		const hpUpgrade = await action('upgrade', 'word', 'maxHp');
		expect(hpUpgrade).toMatchObject({
			effect: { kind: 'upgrade-success' },
			game: { armor: { maxHp: 106 }, iron: 0, weapon: 0 }
		});
		expect(stored.state.player).toMatchObject({ hp: 100, maxHp: 106 });

		stored.state.successRate = 100;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(2);
		expect(await action('upgrade', 'word', 'killRecovery')).toMatchObject({
			game: { armor: { killRecovery: 3 }, silver: 0 }
		});

		stored.state.successRate = 100;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(10);
		expect(await action('upgrade', 'word', 'defense')).toMatchObject({
			game: { armor: { defense: 50 }, stones: 0 }
		});
		stored.state.stones = 2;
		await expect(action('upgrade', 'word', 'defense')).rejects.toMatchObject({ status: 400 });
		expect(stored.state.stones).toBe(2);
	});

	it('reduces wrong-answer and pass damage and heals only on a kill up to max HP', async () => {
		const started = await beginExploration(user);
		const id = started.player!.id;
		Object.assign(stored.state.armor, { defense: 50, killRecovery: 3 });
		expect((await hurtPlayer(user, id, 'wrong', 5)).reward.playerDamage).toBe(5);
		expect((await handlePass(user, 'pass', 5, id)).reward.playerDamage).toBe(5);
		expect((await rewardStudy(user, 'hit', id)).reward.playerHealing).toBeUndefined();
		stored.state.player.hp = 99;
		stored.state.battle.hp = 1;
		const kill = await rewardStudy(user, 'kill', id);
		expect(kill).toMatchObject({ player: { hp: 100 }, reward: { playerHealing: 1 } });
	});
});

describe('vocabulary-scaled monsters', () => {
	it('keeps early HP accessible and increases the gains at high levels', () => {
		for (const [level, hp] of [
			[10, 50],
			[20, 100],
			[50, 469],
			[80, 1037],
			[100, 1500]
		]) {
			expect(monsterStats(level).maxHp).toBe(hp);
			expect(monsterStats(level, true).maxHp).toBe(hp * 4);
		}
	});
	it.each([
		[4, 100, 282, 750, 1500],
		[5, 100, 400, 750, 1500],
		[6, 100, 595, 749, 1500],
		[7, 20, 120, 50, 100],
		[8, 100, 1000, 750, 1500],
		[9, 80, 1643, 519, 1037],
		[10, 20, 200, 50, 100],
		[11, 20, 140, 50, 100]
	])(
		'updates version %i HP once while retaining the remaining health ratio',
		async (version, level, maxHp, expectedHp, expectedMaxHp) => {
			await beginExploration(user);
			stored.state.combatVersion = version;
			Object.assign(stored.state.battle, { level, boss: false, hp: Math.floor(maxHp / 2), maxHp });
			expect((await loadGame(user)).battle).toMatchObject({ hp: expectedHp, maxHp: expectedMaxHp });
			await beginExploration(user);
			expect((await loadGame(user)).battle).toMatchObject({ hp: expectedHp, maxHp: expectedMaxHp });
		}
	);
	it('converts decimal vocabulary levels to integer monster levels and preserves balance', () => {
		expect(monsterLevel(1)).toBe(10);
		expect(monsterLevel(1.01)).toBe(10);
		expect(monsterLevel(5.99)).toBe(59);
		expect(monsterStats(10)).toMatchObject({ level: 10, maxHp: 50, rewardMultiplier: 1 });
		expect(monsterStats(11).maxHp).toBe(52);
		expect(monsterStats(20).maxHp).toBe(100);
		expect(monsterStats(100, true)).toMatchObject({
			level: 100,
			maxHp: 6000,
			rewardMultiplier: 3.7
		});
		expect(monsterStats(NaN).level).toBe(10);
	});
	it('locks the monster tier until death and carries it into the chest', async () => {
		const advanced = { ...user, currentLevel: 5.7 };
		expect((await loadGame(advanced)).battle).toMatchObject({ level: 57, hp: 586 });
		const hit = await rewardStudy(advanced, 'a');
		expect(hit.reward.gold).toBe(1);
		expect(hit.battle.hp).toBe(576);
		expect((await loadGame({ ...user, currentLevel: 9 })).battle.hp).toBe(576);
		stored.state.attack = 1200;
		roll.mockReturnValueOnce(99).mockReturnValueOnce(0);
		const kill = await rewardStudy({ ...user, currentLevel: 9 }, 'b');
		expect(kill.battle).toMatchObject({ level: 90, hp: 1261 });
		const chest = kill.battle.chests[0];
		expect(chest.level).toBe(57);
		roll.mockImplementation((max) => (max === 100 ? 19 : 0));
		const opened = await openChest({ ...user, currentLevel: 10 }, chest.id);
		expect(opened.reward).toMatchObject({ gold: 170, iron: 34, stones: 2 });
		const replay = await openChest(user, chest.id);
		expect(replay.wallet).toEqual(opened.wallet);
	});
	it('preserves legacy wounded monsters and uses current chest payouts', async () => {
		await rewardStudy(user, 'a');
		delete stored.state.battle.level;
		stored.state.battle.chests = [{ id: 'legacy', boss: false }];
		expect((await loadGame({ ...user, currentLevel: 8 })).battle).toMatchObject({
			level: 10,
			hp: 40
		});
		roll.mockImplementation((max) => max - 1);
		expect((await openChest({ ...user, currentLevel: 8 }, 'legacy')).reward).toMatchObject({
			gold: 166,
			iron: 33,
			stones: 1
		});
	});
});

describe('continuous exploration health', () => {
	it('allows chest opening during exhaustion and never pays twice or revives the player', async () => {
		const start = await beginExploration(user);
		stored.state.player.hp = 1;
		await hurtPlayer(user, start.player!.id, 'fatal-with-chest', 1);
		stored.state.battle.chests = [{ id: 'rest-chest', boss: false, level: 10 }];
		const recoverAt = stored.state.player.recoverAt;
		const opened = await openChest(user, 'rest-chest');
		expect(opened.reward.gold).toBe(166);
		expect(opened.player).toMatchObject({ hp: 0, recoverAt });
		const calls = roll.mock.calls.length;
		expect((await openChest(user, 'rest-chest')).wallet).toEqual(opened.wallet);
		expect(roll.mock.calls.length).toBe(calls);
		await expect(beginExploration(user)).rejects.toMatchObject({ status: 429 });
	});
	it('recovers two HP per full minute across reloads, retains partial minutes and caps health', async () => {
		const start = await beginExploration(user);
		const id = start.player!.id;
		const at = start.player!.healedAt!;
		const clock = vi.spyOn(Date, 'now').mockReturnValue(at);
		try {
			vi.mocked(model.updateOne).mockClear();
			expect((await refreshPlayer(user, id)).revision).toBe(start.revision);
			expect(model.updateOne).not.toHaveBeenCalled();
			await hurtPlayer(user, id, 'injury', 5);
			vi.mocked(model.updateOne).mockClear();
			clock.mockReturnValue(at + 59999);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(91);
			expect(model.updateOne).not.toHaveBeenCalled();
			clock.mockReturnValue(at + 60000);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(93);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(93);
			expect(model.updateOne).toHaveBeenCalledTimes(1);
			clock.mockReturnValue(at + 150000);
			expect((await loadGame(user)).player!.hp).toBe(95);
			clock.mockReturnValue(at + 180000);
			expect((await beginExploration(user)).player!.hp).toBe(97);
			clock.mockReturnValue(at + 3600000);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(100);
			await hurtPlayer(user, id, 'new-injury', 5);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(91);
		} finally {
			clock.mockRestore();
		}
	});
	it('never passively heals exhaustion or permits early reentry', async () => {
		const start = await beginExploration(user);
		const id = start.player!.id;
		stored.state.player.hp = 1;
		const dead = await hurtPlayer(user, id, 'fatal', 1);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(dead.player!.recoverAt! - 1);
		try {
			expect((await loadGame(user)).player!.hp).toBe(0);
			await expect(refreshPlayer(user, id)).rejects.toMatchObject({ status: 429 });
			await expect(beginExploration(user)).rejects.toMatchObject({ status: 429 });
		} finally {
			clock.mockRestore();
		}
	});
	it('persists health across starts, deduplicates hits, ends at zero and starts a fresh run', async () => {
		const start = await beginExploration(user);
		const id = start.player!.id;
		expect(start.player!.hp).toBe(100);
		expect((await hurtPlayer(user, id, 'a', 2.4)).player!.hp).toBe(96);
		expect((await hurtPlayer(user, id, 'a', 2.4)).player!.hp).toBe(96);
		expect((await beginExploration(user)).player).toMatchObject({ id, hp: 96, maxHp: 100 });
		for (let i = 0; i < 6; i++) await hurtPlayer(user, id, `hit-${i}`, 10);
		expect((await loadGame(user)).player!.hp).toBe(0);
		await expect(assertExploring(user, id)).rejects.toBeDefined();
		await expect(rewardStudy(user, 'dead', id)).rejects.toBeDefined();
		const recoverAt = stored.state.player.recoverAt;
		expect(recoverAt).toBeGreaterThan(Date.now() + 599000);
		await expect(beginExploration(user)).rejects.toMatchObject({ status: 429 });
		const clock = vi.spyOn(Date, 'now').mockReturnValue(recoverAt - 1);
		await expect(beginExploration(user)).rejects.toMatchObject({ status: 429 });
		clock.mockReturnValue(recoverAt);
		const next = await beginExploration(user);
		clock.mockRestore();
		expect(next.player!.hp).toBe(100);
		expect(next.player!.id).not.toBe(id);
		await expect(hurtPlayer(user, id, 'stale', 1)).rejects.toBeDefined();
	});
	it.each([false, true])(
		'passes heal the monster, trigger normal retaliation and cannot bypass recovery (boss=%s)',
		async (boss) => {
			const start = await beginExploration(user);
			const id = start.player!.id;
			stored.state.battle.boss = boss;
			stored.state.battle.hp = 40;
			const first = await handlePass(user, `${id}:pass`, 2.4, id);
			expect(first.reward).toMatchObject({
				healing: 7,
				playerCritical: false,
				playerDamage: boss ? 6 : 4
			});
			expect(first.player!.hp).toBe(boss ? 94 : 96);
			await handlePass(user, `${id}:pass`, 2.4, id);
			expect(stored.state.player.hp).toBe(first.player!.hp);
			stored.state.player.hp = 1;
			const dead = await handlePass(user, `${id}:fatal`, 10, id);
			expect(dead.player!.hp).toBe(0);
			expect(dead.player!.recoverAt).toBeGreaterThan(Date.now() + 599000);
			await expect(beginExploration(user)).rejects.toMatchObject({ status: 429 });
		}
	);
	it('heals the monster on pass up to its maximum health', async () => {
		await rewardStudy(user, 'a');
		await rewardStudy(user, 'b');
		expect((await handlePass(user, 'skip', 1.1)).reward.healing).toBe(3);
		expect((await handlePass(user, 'skip2', 10)).battle.hp).toBe(50);
	});
	it('migrates fractional snapshots and buffs HP once while keeping wound ratio and chest tier', async () => {
		await rewardStudy(user, 'a');
		delete stored.state.combatVersion;
		stored.state.battle.level = 2.34;
		stored.state.battle.hp = 40;
		stored.state.battle.maxHp = 80;
		stored.state.battle.chests = [{ id: 'old', level: 2.34, boss: false }];
		expect((await loadGame(user)).battle).toMatchObject({ level: 23, hp: 63, maxHp: 125 });
		await beginExploration(user);
		expect((await loadGame(user)).battle).toMatchObject({ level: 23, hp: 63, maxHp: 125 });
		expect(stored.state.battle.chests[0].level).toBe(23);
	});
});

describe('silver and hit income upgrades', () => {
	it('starts at one, consumes only silver, rolls 1–3 gains and resets charge on success', async () => {
		await beginExploration(user);
		expect((await rewardStudy(user, 'first')).reward.gold).toBe(1);
		Object.assign(stored.state, { silver: 10, successRate: 100 });
		const before = {
			gold: stored.state.gold,
			iron: stored.state.iron,
			stones: stored.state.stones,
			attack: stored.state.attack,
			comboRate: stored.state.comboRate
		};
		roll.mockReturnValueOnce(0).mockReturnValueOnce(0);
		await action('upgrade', 'word', 'income');
		expect(stored.state).toMatchObject({
			...before,
			silver: 9,
			hitGold: 2,
			successRate: 0,
			incomeUpgrades: 1
		});
		stored.state.successRate = 100;
		roll.mockReturnValueOnce(99).mockReturnValueOnce(2);
		await action('upgrade', 'word', 'income');
		expect(stored.state).toMatchObject({ hitGold: 5, silver: 6, successRate: 0 });
		expect((await rewardStudy(user, 'second')).reward.gold).toBe(5);
		expect((await rewardStudy(user, 'second')).reward.gold).toBe(0);
		expect((await loadGame(user)).hitGold).toBe(5);
	});
	it('keeps income and charge on failure and never charges insufficient silver', async () => {
		await beginExploration(user);
		Object.assign(stored.state, { silver: 1, successRate: 10 });
		await action('upgrade', 'word', 'income');
		expect(stored.state).toMatchObject({
			silver: 0,
			successRate: 10,
			hitGold: 1,
			incomeUpgrades: 0
		});
		const before = structuredClone(stored.state);
		await expect(action('upgrade', 'word', 'income')).rejects.toMatchObject({ status: 400 });
		expect(stored.state).toEqual(before);
	});
	it('preserves average material ratios with fractional random payouts', () => {
		for (const divisor of [5, 20, CHEST_STONE_GOLD_DIVISOR, 200, 400]) {
			for (let gold = 25; gold <= 350; gold++) {
				let sum = 0;
				for (let roll = 0; roll < divisor; roll++) sum += chestMaterialAmount(gold, divisor, roll);
				expect(sum).toBe(gold);
			}
		}
		expect(chestMaterialAmount(25, CHEST_STONE_GOLD_DIVISOR, 24)).toBe(1);
		expect(chestMaterialAmount(25, CHEST_STONE_GOLD_DIVISOR, 25)).toBe(0);
		expect(chestMaterialAmount(50, CHEST_STONE_GOLD_DIVISOR, 19)).toBe(2);
		expect(chestMaterialAmount(50, CHEST_STONE_GOLD_DIVISOR, 20)).toBe(1);
	});
	it('uses identical chest loot for normal and boss chests, and replays without paying twice', async () => {
		await beginExploration(user);
		stored.state.battle.chests = [
			{ id: 'normal', boss: false, level: 10 },
			{ id: 'boss', boss: true, level: 10 }
		];
		roll.mockImplementation((max) => (max === 100 ? 0 : max - 1));
		const opened = await openChest(user, 'normal');
		expect(opened.reward).toMatchObject({ gold: 166, iron: 33, silver: 8, stones: 1 });
		const calls = roll.mock.calls.length;
		expect((await openChest(user, 'normal')).wallet).toEqual(opened.wallet);
		expect(roll.mock.calls.length).toBe(calls);
		expect((await openChest(user, 'boss')).reward).toMatchObject({
			gold: 166,
			iron: 33,
			silver: 8,
			stones: 1
		});
		expect(stored.state.silver).toBe(16);
		expect(stored.state.stones).toBe(2);
	});
	it('gives existing saves a one-gold default income and zero silver without changing materials', async () => {
		await beginExploration(user);
		delete stored.state.silver;
		delete stored.state.hitGold;
		delete stored.state.incomeUpgrades;
		Object.assign(stored.state, { gold: 100, iron: 5, stones: 2 });
		expect(await loadGame(user)).toMatchObject({
			silver: 0,
			hitGold: 1,
			incomeUpgrades: 0,
			gold: 100,
			iron: 5,
			stones: 2
		});
	});
});
