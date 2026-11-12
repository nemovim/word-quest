import { expect, it, vi } from 'vitest';

import { POST } from '../../src/routes/api/quiz/check/+server';
import { makeUser, makeVoca } from '../helpers/factories';

import { getVocaById } from '$lib/repositories/voca.repository';
import { healMonster, hurtPlayer, readExploration, rewardStudy } from '$lib/server/game';
import { checkQuizAnswer, passQuizAnswer } from '$lib/usecases/quiz.usecase';

vi.mock('$lib/repositories/voca.repository', () => ({ getVocaById: vi.fn() }));
vi.mock('$lib/server/game', () => ({
	readExploration: vi.fn(),
	healMonster: vi.fn(),
	hurtPlayer: vi.fn(),
	rewardStudy: vi.fn()
}));
vi.mock('$lib/usecases/quiz.usecase', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/usecases/quiz.usecase')>()),
	checkQuizAnswer: vi.fn(),
	passQuizAnswer: vi.fn()
}));

it('applies only the manual-pass penalty when the final answer is wrong', async () => {
	const user = makeUser();
	const word = makeVoca();
	const exploration = {} as Awaited<ReturnType<typeof readExploration>>;
	vi.mocked(readExploration).mockResolvedValue(exploration);
	vi.mocked(getVocaById).mockResolvedValue(word);
	vi.mocked(checkQuizAnswer).mockResolvedValue({
		status: 'pass',
		correctAnswer: 'apple'
	} as Awaited<ReturnType<typeof checkQuizAnswer>>);
	vi.mocked(healMonster).mockResolvedValue({
		reward: { playerDamage: 12 }
	} as Awaited<ReturnType<typeof healMonster>>);
	const request = new Request('http://localhost/api/quiz/check', {
		method: 'POST',
		body: JSON.stringify({
			sessionId: 'session',
			actionId: 'attempt',
			vocaId: word._id,
			quizExampleId: 'example-1',
			promptLang: 'ko',
			answerLang: 'en',
			answerText: 'pear',
			isRetry: true,
			passOnWrong: true
		})
	});

	const response = await POST({ locals: { user }, request } as Parameters<typeof POST>[0]);

	expect(await response.json()).toMatchObject({
		status: 'pass',
		combat: { reward: { playerDamage: 12 } }
	});
	expect(healMonster).toHaveBeenCalledExactlyOnceWith(
		user,
		'session:attempt',
		word.difficultyLevel,
		'session',
		exploration
	);
	expect(hurtPlayer).not.toHaveBeenCalled();
	expect(rewardStudy).not.toHaveBeenCalled();
});

it('records a final miss when the player runs out of health', async () => {
	const user = makeUser();
	const word = makeVoca();
	vi.mocked(readExploration).mockResolvedValue({} as Awaited<ReturnType<typeof readExploration>>);
	vi.mocked(getVocaById).mockResolvedValue(word);
	vi.mocked(checkQuizAnswer).mockResolvedValue({ status: 'wrong' } as Awaited<
		ReturnType<typeof checkQuizAnswer>
	>);
	vi.mocked(hurtPlayer).mockResolvedValue({ player: { hp: 0 } } as Awaited<
		ReturnType<typeof hurtPlayer>
	>);
	vi.mocked(passQuizAnswer).mockResolvedValue({ status: 'pass', correctAnswer: 'apple' } as Awaited<
		ReturnType<typeof passQuizAnswer>
	>);
	const request = new Request('http://localhost/api/quiz/check', {
		method: 'POST',
		body: JSON.stringify({
			sessionId: 'session',
			actionId: 'attempt',
			vocaId: word._id,
			quizExampleId: 'example-1',
			promptLang: 'ko',
			answerLang: 'en',
			answerText: 'pear'
		})
	});
	const response = await POST({ locals: { user }, request } as Parameters<typeof POST>[0]);
	expect(await response.json()).toMatchObject({ status: 'wrong', correctAnswer: 'apple' });
	expect(passQuizAnswer).toHaveBeenCalledOnce();
});
