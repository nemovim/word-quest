/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { User } from '$lib/shared/types/user.type';

import { findNewQuizCandidates } from '$lib/repositories/quiz-card.repository';
import {
	beginExploration,
	refreshPlayer,
	hurtPlayer,
	assertExploring,
	actGame,
	loadGame,
	rewardStudy,
	healMonster,
	openChest
} from '$lib/server/game';
import { getRemainingNewVocaCount } from '$lib/service/new-voca-limit.service';
import {
	pickMonster,
	monsterLevel,
	monsterStats,
	bossOrder,
	dungeonIron,
	baseUpgradeChance,
	upgradeChance,
	upgradeCost,
	wordBonus,
	chestMaterialAmount,
	WINDOW_MS
} from '$lib/shared/utils/game.util';
import { checkQuizAnswer } from '$lib/usecases/quiz.usecase';

const roll = vi.hoisted(() => vi.fn((max: number) => max - 1));
vi.mock('node:crypto', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:crypto')>()),
	randomInt: roll
}));

vi.mock('$lib/repositories/quiz-card.repository', () => ({ findNewQuizCandidates: vi.fn() }));
vi.mock('$lib/repositories/review.repository', () => ({
	findReviewedVocaIdsByUserDirection: vi.fn(async () => [])
}));
vi.mock('$lib/repositories/quiz-report.repository', () => ({
	findPendingReportedVocaIds: vi.fn(async () => [])
}));
vi.mock('$lib/repositories/voca.repository', () => ({
	findPermanentlyExcludedVocaIds: vi.fn(async () => [])
}));
vi.mock('$lib/service/new-voca-limit.service', () => ({
	getRemainingNewVocaCount: vi.fn(async () => 40)
}));
vi.mock('$lib/usecases/quiz.usecase', () => ({
	checkQuizAnswer: vi.fn(async () => ({ status: 'correct' }))
}));

const user = { _id: 'player', currentLevel: 1 } as User;
const model = mongoose.model('Game');
let stored: any;
async function action(action: string, answer = 'word', kind = 'attack') {
	const form = new FormData();
	form.set('revision', String(stored?.state.revision ?? 0));
	form.set('action', action);
	form.set('kind', kind);
	form.set('answer', answer);
	return actGame(user, form);
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	roll.mockReset().mockImplementation((max) => max - 1);
	stored = undefined;
	vi.mocked(getRemainingNewVocaCount).mockResolvedValue(40);
	vi.mocked(checkQuizAnswer).mockResolvedValue({ status: 'correct' } as Awaited<
		ReturnType<typeof checkQuizAnswer>
	>);
	vi.mocked(findNewQuizCandidates).mockResolvedValue(
		Array.from({ length: 40 }, (_, i) => ({
			voca: { _id: String(i), targetLang: 'en' },
			quizCard: {
				examples: [
					{
						_id: `example-${i}`,
						sourceSentenceTemplate: '이것은 {{---}}이다',
						sourceFillText: '단어',
						targetSentenceTemplate: 'This is a {{---}}.',
						targetFillText: 'word'
					}
				]
			}
		})) as Awaited<ReturnType<typeof findNewQuizCandidates>>
	);
	vi.spyOn(model, 'findById').mockImplementation(
		() => ({ lean: async () => structuredClone(stored ?? null) }) as any
	);
	vi.spyOn(model, 'updateOne').mockImplementation((async (filter: any, update: any) => {
		if (update.$setOnInsert) {
			stored ??= { _id: 'player', ...structuredClone(update.$setOnInsert) };
			return { modifiedCount: 0 };
		}
		if (
			filter['state.revision'] !== undefined &&
			filter['state.revision'] !== stored.state.revision
		)
			return { modifiedCount: 0 };
		if (filter.lockUntil?.$lte !== undefined && stored.lockUntil > filter.lockUntil.$lte)
			return { modifiedCount: 0 };
		Object.assign(stored, structuredClone(update.$set));
		return { modifiedCount: 1 };
	}) as any);
});

describe('RPG expedition', () => {
	it('loads legacy saves with zero iron and preserves existing materials', async () => {
		await action('start');
		delete stored.state.iron;
		delete stored.state.upgradeFailures;
		stored.state.stones = 7;
		const view = await loadGame(user);
		expect(view.iron).toBe(0);
		expect(view.upgradeFailures).toBe(0);
		expect(view.stones).toBe(7);
		await action('answer');
		expect(stored.state.iron).toBe(0);
		expect(stored.state.stones).toBe(7);
	});
	it('uses only the selected resource and rejects missing materials', async () => {
		await action('start');
		Object.assign(stored.state, { gold: 200, iron: 20, stones: 0, successRate: 70 });
		await expect(action('upgrade', 'word', 'critical')).rejects.toMatchObject({ status: 400 });
		expect(stored.state).toMatchObject({ gold: 200, iron: 20, stones: 0 });
		roll.mockReturnValueOnce(0);
		await action('upgrade');
		expect(stored.state).toMatchObject({
			gold: 200,
			iron: 17,
			stones: 0,
			criticalChance: 1,
			weapon: 1
		});
		expect(upgradeCost(5, 'attack')).toEqual({ silver: 0, gold: 0, iron: 18, stones: 0 });
		expect(upgradeCost(5, 'critical')).toEqual({ silver: 0, gold: 0, iron: 0, stones: 6 });
	});
	it('requires forty available new words and leaves state untouched on failure', async () => {
		vi.mocked(getRemainingNewVocaCount).mockResolvedValue(39);
		await expect(action('start')).rejects.toMatchObject({ status: 400 });
		expect(stored.state.expedition).toBeNull();
		expect(stored.lockUntil).toBe(0);
	});
	it('rewards five eight-word dungeons and opens a boss without leaking answers', async () => {
		await action('start');
		for (let i = 0; i < 40; i++) await action('answer');
		expect(stored.state.gold).toBe(350);
		expect(stored.state.iron).toBe(25);
		expect(stored.state.stones).toBe(0);
		expect(stored.state.expedition.boss).toHaveLength(8);
		const view = await loadGame(user);
		expect(view.expedition).not.toHaveProperty('words');
		expect(view.question).not.toHaveProperty('answer');
		for (let i = 0; i < 8; i++) await action('answer');
		expect(stored.state.victories).toBe(1);
		expect(stored.state.gold).toBe(450);
		expect(stored.state.stones).toBe(1);
		expect(checkQuizAnswer).toHaveBeenCalledTimes(40);
		await expect(action('answer')).rejects.toMatchObject({ status: 400 });
		await expect(action('start')).rejects.toMatchObject({ status: 400 });
	});
	it('keeps mistakes on the same word and prioritizes them for the boss', async () => {
		await action('start');
		await action('hint');
		vi.mocked(checkQuizAnswer).mockResolvedValueOnce({ status: 'wrong' } as Awaited<
			ReturnType<typeof checkQuizAnswer>
		>);
		await action('answer');
		expect(stored.state.expedition.solved).toBe(0);
		expect(stored.state.gold).toBe(0);
		await action('answer');
		expect(checkQuizAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ isRetry: true }));
		expect(bossOrder([0, 3, 1])[0]).toBe(1);
	});
	it('charges upgrade materials and makes the boss take fewer hits', async () => {
		await action('start');
		await expect(action('upgrade')).rejects.toMatchObject({ status: 400 });
		for (let i = 0; i < 40; i++) await action('answer');
		stored.state.successRate = 70;
		roll.mockReturnValueOnce(0);
		await action('upgrade');
		expect(stored.state.gold).toBe(350);
		expect(stored.state.iron).toBe(22);
		expect(stored.state.stones).toBe(0);
		expect(upgradeCost(1)).toEqual({ silver: 0, gold: 0, iron: 6, stones: 0 });
		for (let i = 0; i < Math.ceil(80 / stored.state.attack); i++) await action('answer');
		expect(stored.state.expedition.cleared).toBe(true);
		expect(stored.state.expedition.bossHp).toBe(0);
	});
	it('preserves unfinished expeditions after twelve hours and rejects stale submissions', async () => {
		await action('start');
		stored.state.expedition.startedAt = Date.now() - WINDOW_MS - 1;
		await expect(action('start')).rejects.toMatchObject({ status: 400 });
		const form = new FormData();
		form.set('action', 'answer');
		form.set('revision', '0');
		await expect(actGame(user, form)).rejects.toMatchObject({ status: 409 });
		expect(checkQuizAnswer).not.toHaveBeenCalled();
		await action('answer');
		expect(stored.state.expedition.solved).toBe(1);
	});
});

describe('random rewards and upgrade protection', () => {
	it('reports authoritative hit, drop and miss effects without awarding hint rewards', async () => {
		await action('start');
		roll.mockReturnValueOnce(0);
		const hit = await action('answer');
		expect(hit.effect).toMatchObject({
			kind: 'hit',
			damage: 10,
			gold: 5,
			iron: 0,
			stones: 1,
			clear: null,
			id: stored.state.revision
		});
		vi.mocked(checkQuizAnswer).mockResolvedValueOnce({ status: 'wrong' } as Awaited<
			ReturnType<typeof checkQuizAnswer>
		>);
		const miss = await action('answer');
		expect(miss.effect).toMatchObject({ kind: 'miss', damage: 0, gold: 0, iron: 0, stones: 0 });
		const hint = await action('hint');
		expect(hint.effect).toMatchObject({ kind: 'none', damage: 0, gold: 0, iron: 0, stones: 0 });
	});
	it('reports clear rewards and caps boss damage at remaining HP', async () => {
		await action('start');
		for (let i = 0; i < 7; i++) await action('answer');
		const clear = await action('answer');
		expect(clear.effect).toMatchObject({ kind: 'hit', clear: 'dungeon', gold: 35, iron: 5 });
		for (let i = 8; i < 40; i++) await action('answer');
		stored.state.expedition.bossHp = 2;
		const boss = await action('answer');
		expect(boss.effect).toMatchObject({
			kind: 'hit',
			clear: 'boss',
			damage: 2,
			gold: 100,
			stones: 1
		});
	});
	it('reports upgrade outcomes without treating costs as loot', async () => {
		await action('start');
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
	it('uses exact exclusive drop boundaries and bounded upgrade odds', () => {
		expect(wordBonus(0)).toEqual({ gold: 0, iron: 0, stones: 1 });
		expect(wordBonus(1).stones).toBe(1);
		expect(wordBonus(2).iron).toBe(1);
		expect(wordBonus(19).iron).toBe(1);
		expect(wordBonus(20).gold).toBe(5);
		expect(wordBonus(44).gold).toBe(5);
		expect(wordBonus(45)).toEqual({ gold: 0, iron: 0, stones: 0 });
		expect([9, 10, 34, 35, 99].map(dungeonIron)).toEqual([5, 4, 4, 3, 3]);
		expect(upgradeChance(70)).toBe(70);
		expect(upgradeChance(-1)).toBe(0);
		expect(upgradeChance(120)).toBe(100);
	});
	it('never changes success rate or other resources after repeated failures', async () => {
		await action('start');
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
			criticalChance: 1,
			weapon: 0
		});
		await action('upgrade', 'word', 'critical');
		expect(stored.state).toMatchObject({
			gold: 500,
			iron: 41,
			stones: 2,
			successRate: 70,
			attack: 10,
			criticalChance: 1
		});
	});
	it('uses the word-level base, retains charges on failure and resets after either successful upgrade', async () => {
		await action('start');
		Object.assign(stored.state, { gold: 10000, iron: 20, stones: 3 });
		expect(stored.state.successRate).toBe(10);
		const calls = roll.mock.calls.length;
		roll.mockReturnValueOnce(3);
		await action('upgrade', 'word', 'chance');
		expect(roll.mock.calls.length).toBe(calls + 1);
		expect(roll).toHaveBeenLastCalledWith(5);
		expect(stored.state).toMatchObject({ gold: 9990, iron: 20, stones: 3, successRate: 15 });
		roll.mockReturnValueOnce(15);
		await action('upgrade');
		expect(stored.state).toMatchObject({ iron: 17, successRate: 15, attack: 10 });
		roll.mockReturnValueOnce(14).mockReturnValueOnce(0);
		await action('upgrade');
		expect(stored.state).toMatchObject({ iron: 14, successRate: 10, attack: 12, weapon: 1 });
		roll.mockReturnValueOnce(3);
		await action('upgrade', 'word', 'chance');
		expect(stored.state).toMatchObject({ gold: 9978, successRate: 15 });
		roll.mockReturnValueOnce(0).mockReturnValueOnce(0);
		await action('upgrade', 'word', 'critical');
		expect(stored.state).toMatchObject({
			stones: 2,
			successRate: 10,
			criticalChance: 1.5,
			weapon: 2
		});
		stored.state.successRate = 98;
		await action('upgrade', 'word', 'chance');
		expect(stored.state.successRate).toBe(100);
		const gold = stored.state.gold;
		await expect(action('upgrade', 'word', 'chance')).rejects.toMatchObject({ status: 400 });
		expect(stored.state.gold).toBe(gold);
	});
	it('rounds vocabulary level down and preserves only charged points when the level changes', async () => {
		expect(baseUpgradeChance(2.34)).toBe(23);
		expect(baseUpgradeChance(2.3)).toBe(23);
		expect(baseUpgradeChance(10)).toBe(100);
		const advanced = { ...user, currentLevel: 2.34 };
		await beginExploration(advanced);
		expect((await loadGame(advanced)).successRate).toBe(23);
		stored.state.successRate = 33;
		const higher = { ...user, currentLevel: 3.01 };
		expect(await loadGame(higher)).toMatchObject({ baseSuccessRate: 30, successRate: 40 });
		expect(await loadGame(higher)).toMatchObject({ baseSuccessRate: 30, successRate: 40 });
		expect(await loadGame({ ...user, currentLevel: 1.01 })).toMatchObject({
			baseSuccessRate: 10,
			successRate: 20
		});
		Object.assign(stored.state, { iron: 10 });
		const form = new FormData();
		form.set('action', 'upgrade');
		form.set('kind', 'attack');
		form.set('revision', String(stored.state.revision));
		roll.mockReturnValueOnce(0).mockReturnValueOnce(0);
		await actGame(higher, form);
		expect(stored.state).toMatchObject({ baseSuccessRate: 30, successRate: 30 });
	});
	it.each([0, 1, 2, 3, 4])(
		'charges by a random 2–6 points without increasing equipment upgrades for roll %i',
		async (value) => {
			await action('start');
			stored.state.gold = 10000;
			roll.mockReturnValueOnce(value);
			await action('upgrade', 'word', 'chance');
			expect(stored.state.successRate).toBe(12 + value);
			expect(stored.state).toMatchObject({
				weapon: 0,
				attackUpgrades: 0,
				criticalUpgrades: 0,
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
		await action('start');
		Object.assign(stored.state, { weapon: 4, attack: 29, criticalChance: 12, upgradeFailures: 9 });
		for (const key of [
			'chargeVersion',
			'successRate',
			'chanceUpgrades',
			'attackUpgrades',
			'criticalUpgrades'
		])
			delete stored.state[key];
		expect(await loadGame(user)).toMatchObject({
			attack: 29,
			criticalChance: 12,
			successRate: 10,
			attackUpgrades: 4,
			criticalUpgrades: 4,
			chanceUpgrades: 0
		});
	});
	it('awards rare drops once and cannot reroll a stale submission or a hint', async () => {
		await action('start');
		const revision = stored.state.revision;
		roll.mockReturnValueOnce(0);
		await action('answer');
		expect(stored.state.stones).toBe(1);
		const form = new FormData();
		form.set('revision', String(revision));
		form.set('action', 'answer');
		form.set('answer', 'word');
		await expect(actGame(user, form)).rejects.toMatchObject({ status: 409 });
		await action('hint');
		expect(roll).toHaveBeenCalledTimes(1);
		expect(stored.state.stones).toBe(1);
	});
	it('adds the first-attempt bonus only to clean dungeons', async () => {
		await action('start');
		await action('hint');
		for (let i = 0; i < 8; i++) await action('answer');
		expect(stored.state.iron).toBe(3);
		for (let i = 0; i < 8; i++) await action('answer');
		expect(stored.state.iron).toBe(8);
	});
	it('rolls bonus boss stones only on the winning answer', async () => {
		await action('start');
		for (let i = 0; i < 40; i++) await action('answer');
		for (let i = 0; i < 7; i++) await action('answer');
		const before = roll.mock.calls.length;
		roll.mockReturnValueOnce(0);
		await action('answer');
		expect(roll.mock.calls.length).toBe(before + 1);
		expect(stored.state.stones).toBe(2);
		await expect(action('answer')).rejects.toMatchObject({ status: 400 });
		expect(stored.state.stones).toBe(2);
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
		expect(boss.reward.gold).toBe(10);
		expect(boss.reward.clear).toBe('boss');
		expect(boss.hitGold).toBe(5);
		expect((await loadGame(user)).hitGold).toBe(5);
	});
	it('rolls one percent initial critical hits, doubles upgraded damage and never rerolls duplicates', async () => {
		await beginExploration(user);
		roll.mockReturnValueOnce(0);
		expect((await rewardStudy(user, 'crit')).reward).toMatchObject({
			damage: 20,
			critical: true,
			gold: 1
		});
		const calls = roll.mock.calls.length;
		expect((await rewardStudy(user, 'crit')).reward.damage).toBe(0);
		expect(roll.mock.calls.length).toBe(calls);
		roll.mockReturnValueOnce(10);
		expect((await rewardStudy(user, 'normal')).reward).toMatchObject({
			damage: 10,
			critical: false
		});
		stored.state.weapon = 5;
		stored.state.attack = 45;
		roll.mockReturnValueOnce(0);
		const kill = await rewardStudy(user, 'kill');
		expect(kill.reward).toMatchObject({ damage: 70, critical: true, clear: 'dungeon' });
		expect(kill.battle.chests).toHaveLength(1);
	});
	it('caps critical damage at remaining boss health', async () => {
		await rewardStudy(user, 'init');
		Object.assign(stored.state.battle, { boss: true, maxHp: 160, hp: 7, kills: 5 });
		roll.mockReturnValueOnce(0);
		const result = await rewardStudy(user, 'boss-crit');
		expect(result.reward).toMatchObject({ damage: 7, critical: true, clear: 'boss' });
		expect(result.battle.chests[0].boss).toBe(true);
	});

	it('retains health across answers, strengthens all hits and heals on pass', async () => {
		expect((await rewardStudy(user, 'a')).battle.hp).toBe(90);
		expect((await rewardStudy(user, 'b')).battle.hp).toBe(80);
		expect((await healMonster(user, 'c')).reward.healing).toBe(9);
		expect((await healMonster(user, 'c')).battle.hp).toBe(89);
		expect((await healMonster(user, 'd', 10)).battle.hp).toBe(100);
		expect((await loadGame(user)).battle.hp).toBe(100);
		stored.state.weapon = 10;
		stored.state.attack = 40;
		expect((await rewardStudy(user, 'e')).battle.hp).toBe(60);
		expect((await rewardStudy(user, 'e')).reward.gold).toBe(0);
		expect(findNewQuizCandidates).not.toHaveBeenCalled();
		expect(checkQuizAnswer).not.toHaveBeenCalled();
	});
	it('stores a chest on death, pays only on open and replays without reroll', async () => {
		for (let i = 0; i < 12; i++) await rewardStudy(user, String(i));
		expect(stored.state.gold).toBe(12);
		const view = await loadGame(user);
		expect(view.battle).toMatchObject({ hp: 80, kills: 1 });
		expect(view.battle.chests).toHaveLength(1);
		expect(view.battle).not.toHaveProperty('opened');
		roll.mockImplementation((max) => (max === 100 ? 0 : max - 1));
		const id = view.battle.chests[0].id;
		const opened = await openChest(user, id);
		expect(opened.reward).toMatchObject({ gold: 50, iron: 10, stones: 0 });
		expect(opened.wallet).toMatchObject({ gold: 62, iron: 10, stones: 0 });
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
		expect(stored.state.battle).toMatchObject({ boss: false, hp: 100 });
		roll.mockReturnValueOnce(99).mockReturnValueOnce(4);
		const encounter = await rewardStudy(user, 'rare');
		expect(encounter.battle).toMatchObject({ boss: true, kind: 'guardian', hp: 400 });
		const slain = await rewardStudy(user, 'boss');
		expect(slain.reward).toMatchObject({ damage: 400, clear: 'boss' });
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
		expect((await loadGame(user)).battle).toMatchObject({ boss: true, kind: 'guardian', hp: 400 });
		const calls = roll.mock.calls.length;
		expect((await loadGame(user)).battle.kind).toBe('guardian');
		expect(roll.mock.calls.length).toBe(calls);
		const start = await beginExploration(user);
		expect((await hurtPlayer(user, start.player!.id, 'wrong', 2.5)).reward.playerDamage).toBe(7);
	});
	it('upgrades an existing boss once without changing its wound ratio', async () => {
		await beginExploration(user);
		stored.state.combatVersion = 3;
		Object.assign(stored.state.battle, { boss: true, hp: 60, maxHp: 240 });
		expect((await loadGame(user)).battle).toMatchObject({ hp: 100, maxHp: 400 });
		await beginExploration(user);
		expect((await loadGame(user)).battle).toMatchObject({ hp: 100, maxHp: 400 });
	});
	it('serializes concurrent hits and chest opens without duplicate payout', async () => {
		await rewardStudy(user, 'a');
		const same = await Promise.all([rewardStudy(user, 'b'), rewardStudy(user, 'b')]);
		expect(same.reduce((sum, value) => sum + value.reward.gold, 0)).toBe(1);
		stored.state.weapon = 100;
		stored.state.attack = 310;
		const hit = await rewardStudy(user, 'kill');
		roll.mockImplementation((max) => max - 1);
		await Promise.all([
			openChest(user, hit.battle.chests[0].id),
			openChest(user, hit.battle.chests[0].id)
		]);
		expect(stored.state.gold).toBe(53);
		expect(stored.state.iron).toBe(10);
	});
	it('does not mutate combat while an upgrade holds the save lock', async () => {
		await rewardStudy(user, 'a');
		stored.lockUntil = Date.now() + 60000;
		await expect(rewardStudy(user, 'b')).rejects.toMatchObject({ status: 409 });
		expect(stored.state.gold).toBe(1);
	});
});

describe('random permanent weapon stats', () => {
	it.each(Array.from({ length: 11 }, (_, i) => i))(
		'rolls critical gains in tenths for roll %i',
		async (value) => {
			await beginExploration(user);
			Object.assign(stored.state, { stones: 1, successRate: 100, criticalChance: 1.1 });
			roll.mockReturnValueOnce(0).mockReturnValueOnce(value);
			await action('upgrade', 'word', 'critical');
			expect(stored.state.criticalChance).toBe((16 + value) / 10);
			expect(roll).toHaveBeenLastCalledWith(11);
		}
	);
	it('uses fractional critical chances when rolling hits', async () => {
		await beginExploration(user);
		stored.state.criticalChance = 1.5;
		roll.mockReturnValueOnce(14);
		expect((await rewardStudy(user, 'fractional-critical')).reward.critical).toBe(true);
		roll.mockReturnValueOnce(15);
		expect((await rewardStudy(user, 'fractional-normal')).reward.critical).toBe(false);
	});
	it('preserves legacy attack and critical chance without rerolling on load', async () => {
		await action('start');
		stored.state.weapon = 7;
		delete stored.state.attack;
		delete stored.state.criticalChance;
		expect(await loadGame(user)).toMatchObject({ attack: 31, criticalChance: 20 });
		expect(await loadGame(user)).toMatchObject({ attack: 31, criticalChance: 20 });
	});
	it('separately rolls gains, caps critical chance and rejects capped upgrades without charging', async () => {
		await action('start');
		Object.assign(stored.state, { gold: 1000, iron: 100, stones: 5, criticalChance: 99.3 });
		stored.state.successRate = 70;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(0);
		await action('upgrade');
		expect(stored.state).toMatchObject({ attack: 12, criticalChance: 99.3 });
		stored.state.successRate = 70;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(2);
		await action('upgrade', 'word', 'critical');
		expect(stored.state).toMatchObject({ attack: 12, criticalChance: 100, stones: 4 });
		await expect(action('upgrade', 'word', 'critical')).rejects.toMatchObject({ status: 400 });
		expect(stored.state.stones).toBe(4);
		stored.state.successRate = 70;
		roll.mockReturnValueOnce(0).mockReturnValueOnce(4);
		await action('upgrade');
		expect(stored.state).toMatchObject({ attack: 18, criticalChance: 100 });
		await expect(action('upgrade', 'word', 'unknown')).rejects.toMatchObject({ status: 400 });
	});
});

describe('vocabulary-scaled monsters', () => {
	it('grows HP faster at higher tiers and keeps boss HP at four times normal HP', () => {
		let previousGain = 0;
		for (let level = 20; level <= 100; level += 10) {
			const hp = monsterStats(level).maxHp;
			const gain = hp - monsterStats(level - 10).maxHp;
			expect(gain).toBeGreaterThan(previousGain);
			expect(monsterStats(level, true).maxHp).toBe(hp * 4);
			previousGain = gain;
		}
	});
	it('updates existing HP curves once while retaining the remaining health ratio', async () => {
		await beginExploration(user);
		stored.state.combatVersion = 4;
		Object.assign(stored.state.battle, { level: 100, boss: false, hp: 141, maxHp: 282 });
		expect((await loadGame(user)).battle).toMatchObject({ hp: 200, maxHp: 400 });
		await beginExploration(user);
		expect((await loadGame(user)).battle).toMatchObject({ hp: 200, maxHp: 400 });
	});
	it('converts decimal vocabulary levels to integer monster levels and preserves balance', () => {
		expect(monsterLevel(1)).toBe(10);
		expect(monsterLevel(1.01)).toBe(10);
		expect(monsterLevel(5.99)).toBe(59);
		expect(monsterStats(10)).toMatchObject({ level: 10, maxHp: 100, rewardMultiplier: 1 });
		expect(monsterStats(11).maxHp).toBe(101);
		expect(monsterStats(20).maxHp).toBe(112);
		expect(monsterStats(100, true)).toMatchObject({
			level: 100,
			maxHp: 1600,
			rewardMultiplier: 2.8
		});
		expect(monsterStats(NaN).level).toBe(10);
	});
	it('locks the monster tier until death and carries it into the chest', async () => {
		const advanced = { ...user, currentLevel: 5.7 };
		expect((await loadGame(advanced)).battle).toMatchObject({ level: 57, hp: 204 });
		const hit = await rewardStudy(advanced, 'a');
		expect(hit.reward.gold).toBe(1);
		expect(hit.battle.hp).toBe(194);
		expect((await loadGame({ ...user, currentLevel: 9 })).battle.hp).toBe(194);
		stored.state.attack = 200;
		const kill = await rewardStudy({ ...user, currentLevel: 9 }, 'b');
		expect(kill.battle).toMatchObject({ level: 90, hp: 346 });
		const chest = kill.battle.chests[0];
		expect(chest.level).toBe(57);
		roll.mockImplementation((max) => (max === 100 ? 19 : 0));
		const opened = await openChest({ ...user, currentLevel: 10 }, chest.id);
		expect(opened.reward).toMatchObject({ gold: 42, iron: 9, stones: 1 });
		const replay = await openChest(user, chest.id);
		expect(replay.wallet).toEqual(opened.wallet);
	});
	it('preserves legacy wounded monsters and old chest payouts', async () => {
		await rewardStudy(user, 'a');
		delete stored.state.battle.level;
		stored.state.battle.chests = [{ id: 'legacy', boss: false }];
		expect((await loadGame({ ...user, currentLevel: 8 })).battle).toMatchObject({
			level: 10,
			hp: 90
		});
		roll.mockImplementation((max) => max - 1);
		expect((await openChest({ ...user, currentLevel: 8 }, 'legacy')).reward).toMatchObject({
			gold: 50,
			iron: 10,
			stones: 0
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
		expect(opened.reward.gold).toBe(50);
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
			await hurtPlayer(user, id, 'injury', 5);
			clock.mockReturnValue(at + 59999);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(90);
			clock.mockReturnValue(at + 60000);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(92);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(92);
			clock.mockReturnValue(at + 150000);
			expect((await loadGame(user)).player!.hp).toBe(94);
			clock.mockReturnValue(at + 180000);
			expect((await beginExploration(user)).player!.hp).toBe(96);
			clock.mockReturnValue(at + 3600000);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(100);
			await hurtPlayer(user, id, 'new-injury', 5);
			expect((await refreshPlayer(user, id)).player!.hp).toBe(90);
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
		for (let i = 0; i < 5; i++) await hurtPlayer(user, id, `hit-${i}`, 10);
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
		'passes trigger double retaliation, preserve healing and cannot bypass recovery (boss=%s)',
		async (boss) => {
			const start = await beginExploration(user);
			const id = start.player!.id;
			stored.state.battle.boss = boss;
			stored.state.battle.hp = 50;
			const first = await healMonster(user, `${id}:pass`, 2.4, id);
			expect(first.reward).toMatchObject({
				healing: 7,
				playerCritical: true,
				playerDamage: boss ? 14 : 8
			});
			expect(first.player!.hp).toBe(boss ? 86 : 92);
			await healMonster(user, `${id}:pass`, 2.4, id);
			expect(stored.state.player.hp).toBe(first.player!.hp);
			stored.state.player.hp = 1;
			const dead = await healMonster(user, `${id}:fatal`, 10, id);
			expect(dead.player!.hp).toBe(0);
			expect(dead.player!.recoverAt).toBeGreaterThan(Date.now() + 599000);
			await expect(beginExploration(user)).rejects.toMatchObject({ status: 429 });
		}
	);
	it('heals according to word level with a max HP cap', async () => {
		await rewardStudy(user, 'a');
		await rewardStudy(user, 'b');
		expect((await healMonster(user, 'skip', 1.1)).reward.healing).toBe(3);
		expect((await healMonster(user, 'skip2', 10)).battle.hp).toBe(100);
	});
	it('migrates fractional snapshots and buffs HP once while keeping wound ratio and chest tier', async () => {
		await rewardStudy(user, 'a');
		delete stored.state.combatVersion;
		stored.state.battle.level = 2.34;
		stored.state.battle.hp = 40;
		stored.state.battle.maxHp = 80;
		stored.state.battle.chests = [{ id: 'old', level: 2.34, boss: false }];
		expect((await loadGame(user)).battle).toMatchObject({ level: 23, hp: 59, maxHp: 117 });
		await beginExploration(user);
		expect((await loadGame(user)).battle).toMatchObject({ level: 23, hp: 59, maxHp: 117 });
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
			criticalChance: stored.state.criticalChance
		};
		roll.mockReturnValueOnce(0).mockReturnValueOnce(0);
		await action('upgrade', 'word', 'income');
		expect(stored.state).toMatchObject({
			...before,
			silver: 9,
			hitGold: 2,
			successRate: 10,
			incomeUpgrades: 1
		});
		stored.state.successRate = 100;
		roll.mockReturnValueOnce(99).mockReturnValueOnce(2);
		await action('upgrade', 'word', 'income');
		expect(stored.state).toMatchObject({ hitGold: 5, silver: 6, successRate: 10 });
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
		for (const divisor of [5, 20, 200]) {
			for (let gold = 25; gold <= 350; gold++) {
				let sum = 0;
				for (let roll = 0; roll < divisor; roll++) sum += chestMaterialAmount(gold, divisor, roll);
				expect(sum).toBe(gold);
			}
		}
	});
	it('applies the same material ratios to normal and boss chests without duplicate payouts', async () => {
		await beginExploration(user);
		stored.state.battle.chests = [
			{ id: 'normal', boss: false, level: 10 },
			{ id: 'boss', boss: true, level: 10 }
		];
		roll.mockImplementation((max) => max - 1);
		const opened = await openChest(user, 'normal');
		expect(opened.reward).toMatchObject({ gold: 50, iron: 10, silver: 2, stones: 0 });
		const calls = roll.mock.calls.length;
		expect((await openChest(user, 'normal')).wallet).toEqual(opened.wallet);
		expect(roll.mock.calls.length).toBe(calls);
		expect((await openChest(user, 'boss')).reward).toMatchObject({
			gold: 150,
			iron: 30,
			silver: 7,
			stones: 0
		});
		expect(stored.state.silver).toBe(9);
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
