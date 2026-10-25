<script lang="ts">
	import type { QuizEncounter } from '$lib/shared/types/quiz.type';
	import type { QuizResult, WrongResult } from '../quiz-result';

	import { QUIZ_REPORT_ISSUES, type QuizReportIssue } from '$lib/shared/types/quiz-report.type';
	import { splitQuizTemplate } from '$lib/shared/utils/answer.util';

	let {
		encounter,
		onReport,
		wrongResult,
		isSolved,
		solvedAnswer,
		isSubmitting,
		errorMessage,
		onCheck,
		onPass,
		onJudge
	}: {
		encounter: QuizEncounter;
		onReport: (issues: QuizReportIssue[], details: string) => Promise<void>;
		wrongResult: WrongResult | null;
		isSolved: boolean;
		solvedAnswer: string;
		isSubmitting: boolean;
		errorMessage: string;
		onCheck: (answerText: string) => Promise<QuizResult>;
		onPass: () => Promise<void>;
		onJudge: (answerText: string, regenerate: boolean) => Promise<void>;
	} = $props();

	let answerText = $state('');
	let wrongAttemptCount = $state(0);
	const showAiHelp = false;
	let lastSubmittedAnswer = $state('');
	let localErrorMessage = $state('');
	let answerInput = $state<HTMLInputElement | null>(null);

	const reportIssueOptions: { value: QuizReportIssue; label: string }[] = [
		{ value: QUIZ_REPORT_ISSUES.WORD_MEANING, label: '단어·뜻' },
		{ value: QUIZ_REPORT_ISSUES.EXAMPLE, label: '예문' },
		{ value: QUIZ_REPORT_ISSUES.TRANSLATION, label: '해석' },
		{ value: QUIZ_REPORT_ISSUES.PRONUNCIATION, label: '발음' },
		{ value: QUIZ_REPORT_ISSUES.UTILITY_TOO_HIGH, label: '활용도가 너무 높음' },
		{ value: QUIZ_REPORT_ISSUES.UTILITY_TOO_LOW, label: '활용도가 너무 낮음' },
		{ value: QUIZ_REPORT_ISSUES.DIFFICULTY_TOO_HIGH, label: '난이도가 너무 높음' },
		{ value: QUIZ_REPORT_ISSUES.DIFFICULTY_TOO_LOW, label: '난이도가 너무 낮음' },
		{ value: QUIZ_REPORT_ISSUES.NOT_SUITABLE_FOR_QUIZ, label: '퀴즈에 부적합' },
		{ value: QUIZ_REPORT_ISSUES.OTHER, label: '기타' }
	];

	let isReportOpen = $state(false);
	let selectedIssues = $state<QuizReportIssue[]>([]);
	let reportDetails = $state('');
	let isReporting = $state(false);
	let reportSent = $state(false);
	let reportError = $state('');
	let lastExampleId = $state('');

	const answerParts = $derived(splitQuizTemplate(encounter.answerTemplate));
	const promptParts = $derived({
		...splitQuizTemplate(encounter.promptTemplate),
		text: encounter.promptFillText
	});

	$effect(() => {
		if (lastExampleId === encounter.quizExampleId) return;
		lastExampleId = encounter.quizExampleId;
		wrongAttemptCount = 0;
		isReportOpen = false;
		selectedIssues = [];
		reportDetails = '';
		reportSent = false;
		reportError = '';
		answerText = '';
		lastSubmittedAnswer = '';
		localErrorMessage = '';
		answerInput?.style.removeProperty('width');
		void answerInput?.focus();
	});

	$effect(() => {
		if (isSubmitting) return;
		void answerInput?.focus();
	});

	async function submitAnswer(): Promise<void> {
		const submittedAnswer = answerText.trim();
		if (submittedAnswer === '') {
			localErrorMessage = '답을 먼저 입력해 주세요.';
			return;
		}

		localErrorMessage = '';
		answerText = '';
		answerInput?.style.removeProperty('width');

		try {
			const result = await onCheck(submittedAnswer);
			if (result.status === 'wrong') {
				lastSubmittedAnswer = submittedAnswer;
				wrongAttemptCount += 1;
				if (wrongAttemptCount >= 5) await onPass();
			}
		} catch {
			// parent callback already set the visible error state
		}
	}

	function resizeAnswerInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		localErrorMessage = '';
		input.style.removeProperty('width');
		input.style.width = `${input.scrollWidth}px`;
	}

	async function passAnswer(): Promise<void> {
		if (answerText.trim() !== '' && !confirm('이 문제를 틀린 것으로 기록하고 넘길까요?')) return;
		localErrorMessage = '';
		try {
			await onPass();
		} catch {
			// parent callback already set the visible error state
		}
	}

	async function judgeAnswer(regenerate = false): Promise<void> {
		if (lastSubmittedAnswer === '') return;
		localErrorMessage = '';
		try {
			await onJudge(lastSubmittedAnswer, regenerate);
		} catch {
			// parent callback already set the visible error state
		}
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		await submitAnswer();
	}

	async function handleAnswerKeydown(event: KeyboardEvent): Promise<void> {
		if (!isSolved && event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !isSubmitting) {
			event.preventDefault();
			await passAnswer();
			return;
		}

		const target = event.target;
		const isEditableTarget =
			target instanceof HTMLElement &&
			(target.matches('input, textarea, select') || target.isContentEditable);
		if (
			isSolved ||
			isSubmitting ||
			isReportOpen ||
			isEditableTarget ||
			event.isComposing ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			event.key.length !== 1
		) {
			return;
		}

		void answerInput?.focus();
	}

	async function submitReport(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (selectedIssues.length === 0 || isReporting) return;

		isReporting = true;
		reportError = '';
		try {
			await onReport(selectedIssues, reportDetails.trim());
			reportSent = true;
			isReportOpen = false;
			selectedIssues = [];
			reportDetails = '';
		} catch {
			reportError = '신고를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
		} finally {
			isReporting = false;
		}
	}

	function handleReportKeydown(event: KeyboardEvent): void {
		event.stopPropagation();

		if (event.key !== 'Enter' || event.shiftKey || event.isComposing || isReporting) {
			return;
		}

		event.preventDefault();
		(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
	}
</script>

<svelte:window onkeydown={handleAnswerKeydown} />

<section class="quiz-panel prompt-panel">
	<small class="sentence-label">해석</small>
	<p>
		{promptParts.before}<span class="highlight">{promptParts.text}</span>{promptParts.after}
	</p>
	<hr />
	<small class="sentence-label">예문</small>
	<p>
		{answerParts.before}<span class="blanks" data-count={encounter.answerWordCount}
			>{#if isSolved}
				<span class="solved-answer">{solvedAnswer}</span>
			{:else}<input
					bind:this={answerInput}
					bind:value={answerText}
					oninput={resizeAnswerInput}
					disabled={isSubmitting}
					autocomplete="off"
					enterkeyhint="done"
					form="quiz-answer-form"
					aria-label={wrongResult?.initialHint
						? `예문 빈칸 답안, 첫 글자 힌트 ${wrongResult.initialHint}`
						: '예문 빈칸 답안'}
					placeholder={wrongResult?.initialHint ?? ''}
				/>{/if}{#if !isSolved && encounter.answerWordCount > 1}<small class="word-count"
					>{encounter.answerWordCount}단어</small
				>{/if}</span
		>{answerParts.after}
	</p>

	<div class="report-area">
		{#if reportSent}
			<small class="report-success">신고가 접수되었습니다.</small>
		{:else if !isReportOpen}
			<button type="button" class="report-button" onclick={() => (isReportOpen = true)}>
				문제 신고
			</button>
		{:else}
			<form class="report-form" onsubmit={submitReport}>
				<fieldset>
					<legend>문제 유형 (복수 선택 가능)</legend>
					<div class="issue-options">
						{#each reportIssueOptions as option (option.value)}
							<label>
								<input
									type="checkbox"
									value={option.value}
									bind:group={selectedIssues}
									disabled={isReporting}
								/>
								<span>{option.label}</span>
							</label>
						{/each}
					</div>
				</fieldset>
				<label>
					<span>상세 설명 (선택)</span>
					<textarea
						bind:value={reportDetails}
						maxlength="500"
						disabled={isReporting}
						onkeydown={handleReportKeydown}
						placeholder="설명이 필요하다면 간단히 알려 주세요."></textarea>
				</label>
				<div class="report-actions">
					<button
						type="button"
						class="button secondary"
						onclick={() => (isReportOpen = false)}
						disabled={isReporting}>취소</button
					>
					<button
						type="submit"
						class="button"
						disabled={isReporting || selectedIssues.length === 0}
					>
						{isReporting ? '저장 중…' : '신고 저장'}
					</button>
				</div>
				{#if reportError}
					<aside class="feedback-notice report-error" role="alert">{reportError}</aside>
				{/if}
			</form>
		{/if}
	</div>
</section>
{#if !isSolved}
	<section class="result-panel">
		<form id="quiz-answer-form" class="answer-actions" onsubmit={handleSubmit}>
			<button type="button" class="button secondary" onclick={passAnswer} disabled={isSubmitting}
				>넘기기</button
			>
			<button class="button" type="submit" disabled={isSubmitting}>확인하기</button>
		</form>
		<div class="feedback-notes">
			{#if wrongResult}
				<aside class="wrong-answer" role="status">
					<p class="submitted"><strong>오답</strong> · 내 답: {lastSubmittedAnswer}</p>
					{#if wrongAttemptCount >= 3}<small
							>{5 - wrongAttemptCount}번 더 틀리면 자동으로 넘겨요.</small
						>{/if}
					{#if wrongResult.spellingDistance != null}<p>
							정답과 {wrongResult.spellingDistance}글자 차이예요. 철자를 확인해 보세요.
						</p>{/if}
					{#if wrongResult.hintText}<p>{wrongResult.hintText}</p>{/if}
					{#if showAiHelp && wrongResult.canJudge}
						<button
							type="button"
							class="button secondary"
							onclick={() => judgeAnswer(false)}
							disabled={isSubmitting}
						>
							AI에게 이유 묻기
						</button>
					{:else if showAiHelp && wrongResult.canRegenerate}
						<button
							type="button"
							class="button secondary"
							onclick={() => judgeAnswer(true)}
							disabled={isSubmitting}
						>
							AI 답변 다시 생성
						</button>
					{/if}
				</aside>
			{/if}
			{#if localErrorMessage}
				<aside class="feedback-notice answer-required" role="alert">
					<p>{localErrorMessage}</p>
				</aside>
			{:else if errorMessage}<aside class="feedback-notice message-error" role="alert">
					{errorMessage}
				</aside>{/if}
		</div>
	</section>
{/if}

<style>
	.prompt-panel {
		padding: 0.85rem 1rem;
		border-radius: 0.8rem;
	}
	.sentence-label {
		font-size: 0.7rem;
	}
	.result-panel {
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.feedback-notes {
		flex-wrap: wrap;
	}

	.result-panel {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
	}
	.prompt-panel {
		gap: var(--spacing-2);
		background: var(--paper);
		border: 0.1rem solid var(--line);
		box-shadow: 0 0.6rem 1.5rem var(--shadow-soft);
	}

	p {
		margin: 0;
		font-size: clamp(1.05rem, 2vw, 1.3rem);
		line-height: 1.55;
		overflow-wrap: anywhere;
	}

	small {
		font-weight: 700;
		color: var(--ink-soft);
	}

	hr {
		width: stretch;
		border: none;
		border-top: 0.1rem dashed var(--line);
		margin-block: var(--spacing-2);
	}

	.blanks {
		position: relative;
		display: inline-grid;
		width: fit-content;
		margin: 0 var(--spacing-1);
	}

	.blanks input {
		box-sizing: border-box;
		width: 8rem;
		min-width: 8rem;
		max-width: min(45vw, 14rem);
		border: 0;
		border-bottom: 0.15rem solid var(--brown);
		border-radius: 0.15rem 0.15rem 0 0;
		background: var(--paper-deep);
		padding: 0 var(--spacing-2);
		text-align: center;
	}

	.blanks input:focus {
		outline: none;
	}

	.blanks input::placeholder {
		color: var(--ink-soft);
		opacity: 0.72;
	}

	.word-count {
		position: absolute;
		top: -0.65rem;
		right: 0.2rem;
		z-index: 1;
		padding: 0.08rem 0.3rem;
		border: 0.08rem solid var(--line);
		border-radius: 999px;
		background: var(--paper-soft);
		font-size: var(--text-xs, 0.7rem);
		line-height: 1.2;
		white-space: nowrap;
		pointer-events: none;
	}

	.solved-answer {
		padding: 0.05em 0.35em;
		border-bottom: 0.16rem solid var(--brown);
		background: var(--paper-deep);
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.answer-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-3);
	}
	.feedback-notes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-4);
		align-items: flex-start;
	}
	.feedback-notes p {
		font-size: 0.85rem;
		margin: 0;
	}
	.submitted {
		font-weight: 700;
	}
	.answer-required {
		font-weight: 600;
	}
	.answer-required p {
		font-size: var(--text-base);
	}
	.feedback-notice {
		display: grid;
		gap: 0.45rem;
		width: 100%;
		min-width: 0;
		padding: 0.7rem 0.85rem;
		border: 1px solid var(--line);
		border-radius: 0.7rem;
		background: var(--paper-soft);
		color: var(--brown);
		overflow-wrap: anywhere;
	}
	.wrong-answer {
		display: grid;
		gap: 0.25rem;
		padding: 0.3rem 0.2rem;
		font-size: 0.85rem;
		color: var(--ink-soft);
		overflow-wrap: anywhere;
	}
	.wrong-answer strong {
		color: var(--brown);
	}
	.wrong-answer small {
		font-size: 0.75rem;
		color: var(--ink-soft);
	}
	.message-error {
		color: var(--red);
	}

	.highlight {
		padding: 0.1rem 0.5rem;
		border-radius: 0.2rem;
		background: var(--brown-soft);
		font-weight: 700;
	}

	.report-area {
		display: grid;
		justify-items: end;
		gap: var(--spacing-2);
	}

	.report-button {
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--ink-soft);
		font-size: var(--text-sm);
		text-decoration: underline;
		cursor: pointer;
	}

	.report-form {
		display: grid;
		width: min(100%, 28rem);
		gap: var(--spacing-3);
		padding: var(--spacing-3);
		margin-top: var(--spacing-2);
		border: 0.1rem solid var(--line);
		background: var(--paper-soft);
	}

	.report-form > label {
		display: grid;
		gap: var(--spacing-1);
		justify-items: stretch;
		font-size: var(--text-sm);
	}

	.report-form textarea {
		width: 100%;
		padding: var(--spacing-2);
		border: 0.1rem solid var(--line);
		border-radius: 0.3rem;
		background: var(--paper);
		font: inherit;
	}

	.report-form textarea {
		min-height: 4rem;
		resize: vertical;
	}

	.report-form fieldset {
		padding: 0;
		border: 0;
	}

	.report-form legend {
		margin-bottom: var(--spacing-2);
		font-size: var(--text-sm);
	}

	.issue-options {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--spacing-2);
	}

	.issue-options label {
		display: flex;
		align-items: center;
		gap: var(--spacing-2);
		font-size: var(--text-sm);
	}

	.report-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-2);
	}

	.report-success {
		color: var(--green-deep, var(--ink-soft));
	}

	.report-error {
		color: var(--red);
	}
</style>
