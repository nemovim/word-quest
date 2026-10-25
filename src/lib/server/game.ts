import { randomInt, randomUUID } from 'node:crypto';

import { error } from '@sveltejs/kit';
import mongoose from 'mongoose';

import type { GameEffect } from '$lib/shared/types/game-effect.type';
import type {
	Journey,
	StudyReward,
	BattleView,
	CombatUpdate,
	PlayerHealth
} from '$lib/shared/types/journey.type';
import type { User } from '$lib/shared/types/user.type';

import { findNewQuizCandidates } from '$lib/repositories/quiz-card.repository';
import { findPendingReportedVocaIds } from '$lib/repositories/quiz-report.repository';
import { findReviewedVocaIdsByUserDirection } from '$lib/repositories/review.repository';
import { findPermanentlyExcludedVocaIds } from '$lib/repositories/voca.repository';
import { getRemainingNewVocaCount } from '$lib/service/new-voca-limit.service';
import { normalizeAnswer, fillQuizTemplate } from '$lib/shared/utils/answer.util';
import {
	monsterStats,
	pickMonster,
	monsterLevel,
	wordCombatAmount,
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

type Word = {
	vocaId: string;
	quizExampleId: string;
	prompt: string;
	template: string;
	answer: string;
};
type Expedition = {
	startedAt: number;
	words: Word[];
	solved: number;
	mistakes: number[];
	boss: number[];
	bossSolved: number;
	bossHp: number;
	cleared: boolean;
};
type Battle = BattleView & {
	claims: { key: string; at: number }[];
	opened: Record<string, StudyReward>;
};
type GameState = {
	baseSuccessRate?: number;
	silver: number;
	hitGold: number;
	incomeUpgrades: number;
	chargeVersion?: number;
	successRate: number;
	chanceUpgrades: number;
	attackUpgrades: number;
	criticalUpgrades: number;
	combatVersion?: number;
	player?: PlayerHealth;
	battle?: Battle;
	journey?: Journey;
	revision: number;
	gold: number;
	iron: number;
	stones: number;
	weapon: number;
	attack: number;
	criticalChance: number;
	upgradeFailures: number;
	victories: number;
	expedition: Expedition | null;
};
const schema = new mongoose.Schema({
	_id: { type: String, required: true },
	state: { type: mongoose.Schema.Types.Mixed, required: true },
	lockUntil: { type: Number, default: 0 }
});
const Game = mongoose.models.Game ?? mongoose.model('Game', schema);
const initial = (): GameState => ({
	combatVersion: 5,
	silver: 0,
	hitGold: 1,
	incomeUpgrades: 0,
	chargeVersion: 1,
	successRate: 0,
	chanceUpgrades: 0,
	attackUpgrades: 0,
	criticalUpgrades: 0,
	revision: 0,
	gold: 0,
	iron: 0,
	stones: 0,
	weapon: 0,
	attack: 10,
	criticalChance: 1,
	upgradeFailures: 0,
	victories: 0,
	expedition: null
});

function spawnMonster(level: number) {
	const kind = pickMonster(randomInt(100));
	const boss = kind === 'guardian';
	const stats = monsterStats(monsterLevel(level), boss);
	return { kind, boss, level: stats.level, hp: stats.maxHp, maxHp: stats.maxHp };
}
const freshBattle = (level: number): Battle => ({
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
async function mutateCombat(
	user: User,
	operation: (
		state: GameState,
		battle: Battle
	) => StudyReward & { healing?: number; playerDamage?: number }
): Promise<CombatUpdate> {
	await Game.updateOne(
		{ _id: user._id },
		{ $setOnInsert: { state: initial(), lockUntil: 0 } },
		{ upsert: true }
	);
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const state = await getState(user);
		recoverPlayer(state.player);
		const battle = state.battle ?? freshBattle(user.currentLevel);
		battle.claims = battle.claims.filter((claim) => Date.now() - claim.at < WINDOW_MS);
		const reward = operation(state, battle);
		const revision = state.revision;
		state.battle = battle;
		state.revision += 1;
		const saved = await Game.updateOne(
			{ _id: user._id, 'state.revision': revision, lockUntil: { $lte: Date.now() } },
			{ $set: { state } }
		);
		if (saved.modifiedCount === 1)
			return {
				revision: state.revision,
				hitGold: state.hitGold,
				player: state.player,
				reward,
				battle: battleView(battle),
				wallet: { gold: state.gold, iron: state.iron, stones: state.stones, silver: state.silver }
			};
	}
	error(409, '다른 요청이 진행 중이에요. 잠시 후 다시 시도해 주세요.');
}
const emptyReward = (): StudyReward => ({ gold: 0, iron: 0, stones: 0, damage: 0, clear: null });
export async function rewardStudy(
	user: User,
	key: string,
	sessionId?: string
): Promise<CombatUpdate> {
	return mutateCombat(user, (state, battle) => {
		const reward = emptyReward();
		if (sessionId) assertPlayer(state, sessionId);
		if (battle.claims.some((claim) => claim.key === `hit:${key}`)) return reward;
		battle.claims.push({ key: `hit:${key}`, at: Date.now() });
		reward.critical = randomInt(1000) < Math.round(state.criticalChance * 10);
		reward.damage = Math.min(battle.hp, state.attack * (reward.critical ? 2 : 1));
		battle.hp -= reward.damage;
		reward.gold = state.hitGold * (battle.boss ? 2 : 1);
		state.gold += reward.gold;
		if (battle.hp === 0) {
			reward.clear = battle.boss ? 'boss' : 'dungeon';
			battle.chests.push({ id: randomUUID(), boss: battle.boss, level: battle.level ?? 10 });
			if (battle.boss) state.victories += 1;
			battle.kills += 1;
			Object.assign(battle, spawnMonster(user.currentLevel));
		}
		return reward;
	});
}
export async function healMonster(
	user: User,
	key: string,
	level = 3,
	sessionId?: string
): Promise<CombatUpdate> {
	return mutateCombat(user, (state, battle) => {
		if (sessionId) assertPlayer(state, sessionId);
		const reward = { ...emptyReward(), healing: 0, playerDamage: 0, playerCritical: !!sessionId };
		if (battle.claims.some((claim) => claim.key === `pass:${key}`)) return reward;
		battle.claims.push({ key: `pass:${key}`, at: Date.now() });
		reward.healing = Math.min(wordCombatAmount(level, 3), battle.maxHp - battle.hp);
		battle.hp += reward.healing;
		if (sessionId) {
			const player = assertPlayer(state, sessionId);
			reward.playerDamage = damagePlayer(player, level, battle.boss, true);
		}
		return reward;
	});
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
function damagePlayer(player: PlayerHealth, level: number, boss: boolean, critical = false) {
	const damage = Math.min(player.hp, wordCombatAmount(level, boss ? 3 : 2) * (critical ? 2 : 1));
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
export async function assertExploring(user: User, sessionId: string) {
	return assertPlayer(await getState(user), sessionId);
}
export async function beginExploration(user: User): Promise<CombatUpdate> {
	return mutateCombat(user, (state) => {
		assertRecovered(state);
		if (!state.player || state.player.hp <= 0)
			state.player = { id: randomUUID(), hp: 100, maxHp: 100, healedAt: Date.now() };
		return emptyReward();
	});
}
export async function refreshPlayer(user: User, sessionId: string): Promise<CombatUpdate> {
	return mutateCombat(user, (state) => {
		assertPlayer(state, sessionId);
		return emptyReward();
	});
}
export async function hurtPlayer(
	user: User,
	sessionId: string,
	actionId: string,
	level: number
): Promise<CombatUpdate> {
	return mutateCombat(user, (state, battle) => {
		const reward = { ...emptyReward(), playerDamage: 0 };
		if (battle.claims.some((c) => c.key === `hurt:${sessionId}:${actionId}`)) return reward;
		const player = assertPlayer(state, sessionId);
		reward.playerDamage = damagePlayer(player, level, battle.boss);
		battle.claims.push({ key: `hurt:${sessionId}:${actionId}`, at: Date.now() });
		return reward;
	});
}
export async function openChest(user: User, id: string): Promise<CombatUpdate> {
	return mutateCombat(user, (state, battle) => {
		// Replay the reveal on retries without rolling or paying twice.
		if (Object.hasOwn(battle.opened, id)) return battle.opened[id];
		const chest = battle.chests.find((item) => item.id === id);
		if (!chest) error(404, '이 보물상자를 찾을 수 없어요.');
		const stats = monsterStats(chest.level ?? 10);
		const gold = Math.floor((25 + randomInt(26)) * stats.rewardMultiplier) * (chest.boss ? 3 : 1);
		const reward = {
			...emptyReward(),
			gold,
			iron: chestMaterialAmount(gold, 5, randomInt(5)),
			stones: chestMaterialAmount(gold, 200, randomInt(200))
		};
		const silver = chestMaterialAmount(gold, 20, randomInt(20));
		const loot = { ...reward, silver };
		state.silver += silver;
		state.gold += reward.gold;
		state.iron += reward.iron;
		state.stones += reward.stones;
		battle.chests = battle.chests.filter((item) => item.id !== id);
		battle.opened[id] = loot;
		return loot;
	});
}

async function getState(user: User): Promise<GameState> {
	const document = await Game.findById(user._id).lean<{
		state: GameState & { combatVersion?: number };
	}>();
	if (document && (document.state.combatVersion ?? 0) < 2) {
		const battle = document.state.battle;
		if (battle) {
			battle.level = monsterLevel(battle.level ?? 1);
			battle.chests = battle.chests.map((chest) => ({
				...chest,
				level: monsterLevel(chest.level ?? 1)
			}));
		}
		document.state.combatVersion = 2;
	}
	if (document && (document.state.combatVersion ?? 0) < 3) {
		const battle = document.state.battle;
		if (battle) {
			battle.maxHp = Math.floor(battle.maxHp * 1.5);
			battle.hp = Math.min(battle.maxHp, Math.floor(battle.hp * 1.5));
		}
		document.state.combatVersion = 3;
	}

	if (document && (document.state.combatVersion ?? 0) < 4) {
		const battle = document.state.battle;
		if (battle?.boss) {
			battle.maxHp *= 2;
			battle.hp *= 2;
		}
		document.state.combatVersion = 4;
	}
	if (document && (document.state.combatVersion ?? 0) < 5) {
		const battle = document.state.battle;
		if (battle) {
			const maxHp = monsterStats(battle.level ?? 10, battle.boss).maxHp;
			battle.hp = Math.min(maxHp, Math.ceil((battle.hp / battle.maxHp) * maxHp));
			battle.maxHp = maxHp;
		}
		document.state.combatVersion = 5;
	}

	const state = document
		? {
				...document.state,
				silver: document.state.silver ?? 0,
				hitGold: document.state.hitGold ?? 1,
				incomeUpgrades: document.state.incomeUpgrades ?? 0,
				chargeVersion: 1,
				successRate: document.state.chargeVersion === 1 ? (document.state.successRate ?? 0) : 0,
				chanceUpgrades:
					document.state.chargeVersion === 1 ? (document.state.chanceUpgrades ?? 0) : 0,
				attackUpgrades: document.state.attackUpgrades ?? document.state.weapon,
				criticalUpgrades: document.state.criticalUpgrades ?? document.state.weapon,
				iron: document.state.iron ?? 0,
				upgradeFailures: document.state.upgradeFailures ?? 0,
				attack: document.state.attack ?? 10 + document.state.weapon * 3,
				criticalChance: document.state.criticalChance ?? 20
			}
		: initial();
	const base = baseUpgradeChance(user.currentLevel);
	return {
		...state,
		baseSuccessRate: base,
		successRate: Math.min(100, base + Math.max(0, state.successRate - (state.baseSuccessRate ?? 0)))
	};
}

export async function loadGame(user: User) {
	let state = await getState(user);
	if (
		!state.battle ||
		(state.player &&
			state.player.hp > 0 &&
			(state.player.healedAt == null ||
				(state.player.hp < state.player.maxHp && Date.now() - state.player.healedAt >= 60000)))
	) {
		await mutateCombat(user, () => emptyReward());
		state = await getState(user);
	}
	const expedition = state.expedition;
	const index =
		expedition == null
			? -1
			: expedition.solved < 40
				? expedition.solved
				: expedition.boss[expedition.bossSolved];
	const word = expedition?.words[index];
	return {
		...state,
		hitGold: state.hitGold,
		battle: battleView(state.battle ?? freshBattle(user.currentLevel)),
		journey:
			state.journey && !(state.journey.cleared && Date.now() >= state.journey.startedAt + WINDOW_MS)
				? {
						solved: state.journey.solved,
						bossHp: state.journey.bossHp,
						cleared: state.journey.cleared,
						startedAt: state.journey.startedAt
					}
				: null,
		expedition:
			expedition == null
				? null
				: {
						startedAt: expedition.startedAt,
						solved: expedition.solved,
						bossSolved: expedition.bossSolved,
						bossHp: expedition.bossHp,
						cleared: expedition.cleared
					},
		question:
			word == null || expedition?.cleared ? null : { prompt: word.prompt, template: word.template },
		remaining: await getRemainingNewVocaCount(user._id, new Date()),
		serverNow: Date.now()
	};
}

export async function actGame(user: User, form: FormData) {
	await Game.updateOne(
		{ _id: user._id },
		{ $setOnInsert: { state: initial(), lockUntil: 0 } },
		{ upsert: true }
	);
	const lockUntil = Date.now() + 120_000;
	const locked = await Game.updateOne(
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
		return await actGameLocked(user, form);
	} finally {
		await Game.updateOne({ _id: user._id, lockUntil }, { $set: { lockUntil: 0 } });
	}
}

async function actGameLocked(user: User, form: FormData) {
	const state = await getState(user);
	const revision = Number(form.get('revision'));
	if (revision !== state.revision)
		error(409, '진행 상황이 바뀌었어요. 새로고침 후 다시 시도해 주세요.');
	const action = form.get('action');
	const before = {
		gold: state.gold,
		iron: state.iron,
		stones: state.stones,
		weapon: state.weapon,
		successRate: state.successRate,
		solved: state.expedition?.solved ?? 0,
		bossSolved: state.expedition?.bossSolved ?? 0,
		bossHp: state.expedition?.bossHp ?? 80,
		cleared: state.expedition?.cleared ?? false
	};
	let message = '';
	if (action === 'start') {
		if (
			state.expedition &&
			(!state.expedition.cleared || Date.now() < state.expedition.startedAt + WINDOW_MS)
		)
			error(400, '현재 탐험을 완료하고 12시간 후 다음 탐험을 시작할 수 있어요.');
		if ((await getRemainingNewVocaCount(user._id, new Date())) < 40)
			error(
				400,
				'새 단어 학습 여유가 40개일 때 탐험을 시작할 수 있어요. 기존 학습의 12시간 제한이 풀린 뒤 다시 와 주세요.'
			);
		const [reviewed, pending, excluded] = await Promise.all([
			findReviewedVocaIdsByUserDirection(user._id, 'promptLang', 'ko'),
			findPendingReportedVocaIds(),
			findPermanentlyExcludedVocaIds()
		]);
		const candidates = await findNewQuizCandidates({
			currentLevel: user.currentLevel,
			evidenceCount: 0,
			excludedVocaIds: [...reviewed, ...pending, ...excluded],
			limit: 40,
			targetLang: 'en'
		});
		const words = candidates
			.filter(({ voca, quizCard }) => voca.targetLang === 'en' && quizCard.examples.length > 0)
			.slice(0, 40)
			.map(({ voca, quizCard }) => {
				const example = quizCard.examples[0];
				return {
					vocaId: voca._id,
					quizExampleId: example._id,
					prompt: fillQuizTemplate(example.sourceSentenceTemplate, example.sourceFillText),
					template: example.targetSentenceTemplate,
					answer: example.targetFillText
				};
			});
		if (words.length !== 40)
			error(400, '탐험에 필요한 새로운 영어 단어 40개가 아직 부족해요. 단어를 추가해 주세요.');
		state.expedition = {
			startedAt: Date.now(),
			words,
			solved: 0,
			mistakes: Array(40).fill(0),
			boss: [],
			bossSolved: 0,
			bossHp: 80,
			cleared: false
		};
		message = '단어 숲에 도착! 슬라임과 첫 8단어를 만나봐요.';
	} else if (action === 'upgrade') {
		const kind = form.get('kind');
		if (kind !== 'chance' && kind !== 'attack' && kind !== 'critical' && kind !== 'income')
			error(400, '강화할 항목을 선택해 주세요.');
		if (kind !== 'chance' && state.successRate <= 0)
			error(400, '골드로 강화 성공률을 먼저 충전해 주세요.');
		if (kind === 'chance' && state.successRate >= 100) error(400, '강화 성공률이 이미 최대예요.');
		if (kind === 'critical' && state.criticalChance >= 100)
			error(400, '치명타 확률이 이미 최대예요.');
		const level =
			kind === 'chance'
				? state.weapon
				: kind === 'attack'
					? state.attackUpgrades
					: kind === 'critical'
						? state.criticalUpgrades
						: state.incomeUpgrades;
		const cost = upgradeCost(level, kind, state.successRate);
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
		if (kind === 'chance') {
			const gain = Math.min(2 + randomInt(5), 100 - state.successRate);
			state.successRate += gain;
			state.chanceUpgrades += 1;
			message = `강화 성공률 +${gain}%p → ${state.successRate}%`;
		} else if (randomInt(100) < upgradeChance(state.successRate)) {
			if (kind === 'attack') {
				const gain = 2 + randomInt(5);
				state.attack += gain;
				state.attackUpgrades += 1;
				message = `공격력 +${gain} → ${state.attack}`;
			} else if (kind === 'income') {
				const gain = 1 + randomInt(3);
				state.hitGold += gain;
				state.incomeUpgrades += 1;
				message = `명중 골드 +${gain} → ${state.hitGold}`;
			} else {
				const before = state.criticalChance;
				state.criticalChance = Math.min(100, Math.round(before * 10 + 5 + randomInt(11)) / 10);
				const gain = (Math.round(state.criticalChance * 10) - Math.round(before * 10)) / 10;
				state.criticalUpgrades += 1;
				message = `치명타 확률 +${gain.toFixed(1)}%p → ${state.criticalChance.toFixed(1)}%`;
			}
			state.weapon += 1;
			state.successRate = baseUpgradeChance(user.currentLevel);
			state.baseSuccessRate = state.successRate;
			state.chanceUpgrades = 0;
			message += ` · 기본 성공률 ${state.successRate}%로 초기화`;
		} else {
			message = `강화 실패 · 능력치 유지 · 성공률 ${state.successRate}%`;
		}
	} else if (action === 'answer' || action === 'hint') {
		const expedition = state.expedition;
		if (!expedition || expedition.cleared) error(400, '먼저 탐험을 시작해 주세요.');
		const isBoss = expedition.solved === 40;
		const index = isBoss ? expedition.boss[expedition.bossSolved] : expedition.solved;
		const word = expedition.words[index];
		if (action === 'hint') {
			expedition.mistakes[index] += 1;
			message = `힌트는 ${word.answer}! 한 번 읽고 직접 입력해 봐요.`;
		} else {
			const answer = String(form.get('answer') ?? '').trim();
			if (!answer || answer.length > 200) error(400, '200자 이내로 정답을 입력해 주세요.');
			const correct = isBoss
				? normalizeAnswer(answer, 'en') === normalizeAnswer(word.answer, 'en')
				: (
						await checkQuizAnswer({
							user,
							vocaId: word.vocaId,
							quizExampleId: word.quizExampleId,
							promptLang: 'ko',
							answerLang: 'en',
							answerText: answer,
							isRetry: expedition.mistakes[index] > 0
						})
					).status === 'correct';
			if (!correct) {
				expedition.mistakes[index] += 1;
				message = '괜찮아요, 한 번 더! 헷갈리면 힌트를 눌러봐요.';
			} else if (isBoss) {
				expedition.bossSolved += 1;
				expedition.bossHp = Math.max(0, expedition.bossHp - state.attack);
				message = `정답! ${state.attack} 피해를 입혔어요.`;
				if (expedition.bossHp === 0) {
					expedition.cleared = true;
					state.gold += 100;
					const stones = randomInt(100) < 20 ? 2 : 1;
					state.stones += stones;
					state.victories += 1;
					message = `${stones === 2 ? '희귀 보상! ' : ''}보스 클리어 · 골드 +100 · 강화석 +${stones}`;
				}
			} else {
				expedition.solved += 1;
				const dungeonCleared = expedition.solved % 8 === 0;
				const bonus = wordBonus(randomInt(100));
				const perfect =
					dungeonCleared &&
					expedition.mistakes
						.slice(expedition.solved - 8, expedition.solved)
						.every((count) => count === 0);
				const iron = (dungeonCleared ? dungeonIron(randomInt(100)) : 0) + (perfect ? 2 : 0);
				state.gold += 5 + (dungeonCleared ? 30 : 0) + bonus.gold;
				state.iron += iron + bonus.iron;
				state.stones += bonus.stones;
				message = dungeonCleared
					? `던전 클리어 · 골드 +${35 + bonus.gold} · 철 +${iron + bonus.iron}`
					: `정답 · 골드 +${5 + bonus.gold}${bonus.iron ? ' · 철 +1' : ''}`;
				if (bonus.stones) message += ' · 희귀 드롭! 강화석 +1';
				if (bonus.gold) message += ' · 골드 보너스!';
				if (perfect) message += ' · 8단어 첫 시도 정답 보너스 포함';
				if (expedition.solved === 40) {
					expedition.boss = bossOrder(expedition.mistakes);
					message += ' 보스전이 열렸어요!';
				}
			}
		}
	} else error(400, '알 수 없는 행동이에요.');
	state.revision += 1;
	const result = await Game.updateOne(
		{ _id: user._id, 'state.revision': revision },
		{ $set: { state } }
	);
	if (result.modifiedCount !== 1)
		error(409, '다른 창에서 진행 상황이 바뀌었어요. 새로고침해 주세요.');
	const answered =
		action === 'answer' &&
		(state.expedition!.solved > before.solved || state.expedition!.bossSolved > before.bossSolved);
	const effect: GameEffect = {
		id: state.revision,
		kind:
			action === 'upgrade'
				? state.weapon > before.weapon || state.successRate > before.successRate
					? 'upgrade-success'
					: 'upgrade-failure'
				: action === 'answer'
					? answered
						? 'hit'
						: 'miss'
					: 'none',
		damage: answered
			? before.solved === 40
				? before.bossHp - state.expedition!.bossHp
				: state.attack
			: 0,
		gold: Math.max(0, state.gold - before.gold),
		iron: Math.max(0, state.iron - before.iron),
		stones: Math.max(0, state.stones - before.stones),
		clear:
			answered && state.expedition!.cleared && !before.cleared
				? 'boss'
				: answered && state.expedition!.solved > before.solved && state.expedition!.solved % 8 === 0
					? 'dungeon'
					: null
	};
	return { message, effect };
}
