<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	import DungeonStatus from './DungeonStatus.svelte';
	import QuizHeader from './QuizHeader.svelte';
	import QuizPrompt from './QuizPrompt.svelte';
	import QuizSolvedPanel from './QuizSolvedPanel.svelte';

	import type { BattleView, CombatUpdate, PlayerHealth } from '$lib/shared/types/journey.type';
	import type { QuizReportIssue } from '$lib/shared/types/quiz-report.type';
	import type { QuizEncounter, QuizPageData } from '$lib/shared/types/quiz.type';
	import type { QuizResult, SolvedResult, WrongResult } from '../quiz-result';

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { splitQuizTemplate } from '$lib/shared/utils/answer.util';

	let {
		pageData,
		game
	}: {
		pageData: QuizPageData;
		game: {
			player?: PlayerHealth;
			attack: number;
			criticalChance: number;
			gold: number;
			iron: number;
			stones: number;
			silver?: number;
			hitGold?: number;
			battle: BattleView;
		};
	} = $props();
	let combat = $state<CombatUpdate | null>(null);

	function applyCombat(value: CombatUpdate) {
		if (!combat || value.revision >= combat.revision) combat = value;
	}

	let remainingQueue = $state<QuizEncounter[]>([]);
	let loading = $state(true);
	let now = $state(Date.now());
	const player = $derived(combat?.player ?? game.player);
	const exhausted = $derived(player?.hp === 0);
	const recoverySeconds = $derived(Math.max(0, Math.ceil(((player?.recoverAt ?? 0) - now) / 1000)));
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	let alive = true;
	let turnId = '';
	let currentEncounter = $state<QuizEncounter | null>(null);
	let result = $state<QuizResult | null>(null);
	const answerParts = $derived(
		currentEncounter ? splitQuizTemplate(currentEncounter.answerTemplate) : null
	);
	const finalAnswer = $derived(result?.correctAnswer ?? '');
	let isSubmitting = $state(false);
	let errorMessage = $state('');

	let isRetrying = $state(false);

	const solvedResult = $derived.by<SolvedResult | null>(() =>
		result?.status === 'wrong' ? null : result
	);
	const wrongResult = $derived.by<WrongResult | null>(() =>
		result?.status === 'wrong' ? result : null
	);

	onMount(() => {
		const clock = setInterval(() => (now = Date.now()), 1000);
		void (async () => {
			try {
				const started = await postQuiz<CombatUpdate>('/api/quiz/batch', { start: true });
				if (!alive) return;
				applyCombat(started);
				remainingQueue = [...pageData.encounters];
				await moveToNextEncounter();
			} catch (error) {
				errorMessage =
					error instanceof Error ? error.message : '탐험을 시작하지 못했어요. 새로고침해 주세요.';
				loading = false;
			}
		})();
		return () => clearInterval(clock);
	});
	onDestroy(() => {
		alive = false;
		clearTimeout(pollTimer);
	});
	onMount(() => {
		let refreshing = false;
		const timer = setInterval(async () => {
			if (refreshing || isSubmitting || loading || !combat?.player || combat.player.hp <= 0) return;
			refreshing = true;
			try {
				const updated = await postQuiz<CombatUpdate>('/api/quiz/batch', {
					health: true,
					sessionId: combat.player.id
				});
				if (alive && updated.player?.hp !== combat?.player?.hp) applyCombat(updated);
			} catch {
				// The next combat request also applies elapsed recovery time.
			} finally {
				refreshing = false;
			}
		}, 15000);
		return () => clearInterval(timer);
	});
	async function loadMore() {
		if (loading || combat?.player?.hp === 0) return;
		loading = true;
		clearTimeout(pollTimer);
		try {
			if (!combat?.player)
				applyCombat(await postQuiz<CombatUpdate>('/api/quiz/batch', { start: true }));
			const next = await postQuiz<QuizPageData>('/api/quiz/batch', {
				sessionId: combat?.player?.id,
				direction: pageData.directionMode
			});
			if (!alive) return;
			remainingQueue = next.encounters;
			currentEncounter = remainingQueue.shift() ?? null;
			turnId = crypto.randomUUID();
			errorMessage = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : '문제를 불러오지 못했어요.';
		} finally {
			loading = false;
		}
		if (alive && !currentEncounter)
			pollTimer = setTimeout(() => {
				void loadMore();
			}, 60000);
	}
	function resetTurn(): void {
		result = null;
		errorMessage = '';
	}

	async function moveToNextEncounter(): Promise<void> {
		if (combat?.player?.hp === 0) return;
		resetTurn();
		isRetrying = false;
		turnId = crypto.randomUUID();
		currentEncounter = remainingQueue.shift() ?? null;
		loading = false;
		if (!currentEncounter) await loadMore();
	}
	function removeEncounterFromQueues(vocaId: string): void {
		remainingQueue = remainingQueue.filter((encounter) => encounter.vocaId !== vocaId);
	}

	function getBasePayload(encounter: QuizEncounter) {
		return {
			sessionId: combat?.player?.id,
			actionId: turnId,
			vocaId: encounter.vocaId,
			quizExampleId: encounter.quizExampleId,
			promptLang: encounter.promptLang,
			answerLang: encounter.answerLang
		};
	}

	async function postQuiz<T>(
		path:
			| '/api/quiz/batch'
			| '/api/quiz/check'
			| '/api/quiz/pass'
			| '/api/quiz/judge'
			| '/api/quiz/report',
		payload: unknown
	): Promise<T> {
		const response = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const text = await response.text();
			let message = text;
			try {
				message = JSON.parse(text).message ?? text;
			} catch {
				/* Plain text errors are also supported. */
			}
			throw new Error(message || '요청을 처리하지 못했습니다.');
		}

		return (await response.json()) as T;
	}

	async function runSubmission<T>(fallbackMessage: string, task: () => Promise<T>): Promise<T> {
		isSubmitting = true;
		errorMessage = '';

		try {
			return await task();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : fallbackMessage;
			throw error;
		} finally {
			isSubmitting = false;
		}
	}

	async function checkAnswer(answerText: string): Promise<QuizResult> {
		if (currentEncounter == null || combat?.player?.hp === 0) {
			throw new Error('풀고 있는 문제가 없습니다.');
		}

		const encounter = currentEncounter;

		return runSubmission('정답을 확인하지 못했습니다.', async () => {
			const response = await postQuiz<QuizResult & { combat: CombatUpdate | null }>(
				'/api/quiz/check',
				{
					...getBasePayload(encounter),
					answerText,
					actionId: crypto.randomUUID(),
					isRetry: isRetrying
				}
			);
			result = response;
			if (response.status === 'wrong') isRetrying = true;
			if (response.combat) applyCombat(response.combat);
			return result;
		});
	}

	async function passCurrentCard(): Promise<void> {
		if (currentEncounter == null || combat?.player?.hp === 0) {
			return;
		}

		const encounter = currentEncounter;
		await runSubmission('문제를 넘기지 못했습니다.', async () => {
			const response = await postQuiz<SolvedResult & { combat: CombatUpdate }>('/api/quiz/pass', {
				...getBasePayload(encounter),
				isRetry: isRetrying
			});
			result = response;
			applyCombat(response.combat);
		});
	}

	async function judgeCurrentAnswer(answerText: string, regenerate: boolean): Promise<void> {
		if (currentEncounter == null || combat?.player?.hp === 0) {
			return;
		}

		const encounter = currentEncounter;

		await runSubmission('AI 설명을 요청하지 못했습니다.', async () => {
			result = await postQuiz<WrongResult>('/api/quiz/judge', {
				...getBasePayload(encounter),
				answerText,
				regenerate
			});
		});
	}

	async function reportCurrentEncounter(issues: QuizReportIssue[], details: string): Promise<void> {
		if (currentEncounter == null) return;

		const encounter = currentEncounter;
		await postQuiz<{ ok: true }>('/api/quiz/report', {
			...getBasePayload(encounter),
			issues,
			details
		});
		removeEncounterFromQueues(encounter.vocaId);
		moveToNextEncounter();
	}
</script>

<DungeonStatus {game} {combat} onUpdate={applyCombat} />

{#if exhausted}
	<section class="quiz-panel complete exhaustion">
		<span class="rest-icon" aria-hidden="true">☾</span>
		<h2>잠시 쉬어 가세요</h2>
		<p>체력을 모두 사용했어요. 보물상자는 쉬는 동안에도 열 수 있어요.</p>
		<div class="recovery" role="status">
			<span>{recoverySeconds > 0 ? '다음 탐험까지' : '회복 완료'}</span>
			<strong
				>{Math.floor(recoverySeconds / 60)}:{String(recoverySeconds % 60).padStart(2, '0')}</strong
			>
		</div>
		{#if currentEncounter && finalAnswer}
			<div class="final-answer">
				<QuizHeader encounter={currentEncounter} />
				<small>마지막 문제의 정답</small>
				<strong>{finalAnswer}</strong>
				{#if result?.pronunciationText}<small>[{result.pronunciationText}]</small>{/if}
				{#if answerParts}<p>{answerParts.before}<b>{finalAnswer}</b>{answerParts.after}</p>{/if}
			</div>
		{/if}
		<button class="button" type="button" onclick={() => goto(resolve('/'), { invalidateAll: true })}
			>{finalAnswer ? '정답 확인 완료 · 대시보드로' : '대시보드로 돌아가기'}</button
		>
	</section>
{:else if currentEncounter == null}
	<section class="quiz-panel complete">
		<h2>{loading ? '다음 단어를 불러오는 중…' : '잠시 숨을 고르세요'}</h2>
		<p>
			{errorMessage ||
				(loading ? '' : '지금 학습할 단어가 없어요. 1분마다 복습할 단어를 확인합니다.')}
		</p>
		<div class="complete-actions">
			<a class="button secondary" href={resolve('/')} data-sveltekit-preload-data="off">
				학습 기록 보기
			</a>
			<button type="button" class="button" disabled={loading} onclick={loadMore}>다시 확인</button>
		</div>
	</section>
{:else}
	<section class="quiz-page">
		<QuizHeader encounter={currentEncounter} />

		<QuizPrompt
			encounter={currentEncounter}
			{wrongResult}
			isSolved={solvedResult != null}
			solvedAnswer={solvedResult?.correctAnswer ?? ''}
			{isSubmitting}
			{errorMessage}
			onCheck={checkAnswer}
			onPass={passCurrentCard}
			onJudge={judgeCurrentAnswer}
			onReport={reportCurrentEncounter}
		/>

		{#if solvedResult != null}
			<QuizSolvedPanel {solvedResult} onNext={moveToNextEncounter} />
		{/if}
	</section>
{/if}

<style>
	.exhaustion {
		margin-top: 1rem;
		border: 1px solid var(--line);
		border-radius: 1.2rem;
		text-align: center;
		justify-items: center;
	}
	.rest-icon {
		font-size: 2.5rem;
		color: var(--brown);
	}
	.recovery {
		display: grid;
		gap: 0.3rem;
		padding: 1rem 2rem;
		border-radius: 1rem;
		background: var(--paper-deep);
		color: var(--brown);
	}
	.recovery strong {
		font-size: 2rem;
		font-variant-numeric: tabular-nums;
	}
	.final-answer {
		display: grid;
		gap: 0.6rem;
		width: 100%;
		padding: 1rem;
		border-block: 1px solid var(--line);
		text-align: left;
	}
	.final-answer > strong {
		font-size: 1.5rem;
		color: var(--brown);
	}
	.final-answer small {
		color: var(--ink-soft);
	}
	.quiz-page {
		margin-top: 0.65rem;
		display: grid;
		gap: 0.65rem;
	}

	:global(.quiz-panel) {
		display: grid;
		gap: var(--spacing-4);
		padding-block: clamp(var(--spacing-4), 2.5vw, var(--spacing-6));
		padding-inline: clamp(var(--spacing-4), 2.5vw, var(--spacing-6));
		background: var(--paper-soft);
		box-shadow: 0 0.35rem 1rem var(--shadow-soft);
	}

	.complete :is(h2, p) {
		margin: 0;
	}

	.complete a {
		text-decoration: none;
	}

	.complete-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--spacing-3);
	}
</style>
