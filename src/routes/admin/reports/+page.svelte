<script lang="ts">
	import type {
		QuizReportGround,
		QuizReportIssue,
		QuizReportRecommendation,
		QuizReportVocaSnapshot
	} from '$lib/shared/types/quiz-report.type';
	import type { PartOfSpeech } from '$lib/shared/types/voca.type';
	import type { ActionData, PageData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';

	import { enhance } from '$app/forms';
	import { QUIZ_REPORT_APPLY_SECTIONS } from '$lib/shared/types/quiz-report.type';
	import { PARTS_OF_SPEECH } from '$lib/shared/types/voca.type';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let pendingReportId = $state<string | null>(null);
	let pendingMessage = $state('');
	let visibleSnapshots = $state<Record<string, boolean>>({});

	const issueLabels: Record<QuizReportIssue, string> = {
		wordMeaning: '단어·뜻',
		example: '예문',
		translation: '해석',
		pronunciation: '발음',
		utilityTooHigh: '활용도 높음',
		utilityTooLow: '활용도 낮음',
		difficultyTooHigh: '난이도 높음',
		difficultyTooLow: '난이도 낮음',
		notSuitableForQuiz: '퀴즈 부적합',
		other: '기타'
	};
	const recommendationLabels: Record<QuizReportRecommendation, string> = {
		keep: '유지',
		repair: '수정',
		exclude: '영구 제외'
	};
	const groundLabels: Record<QuizReportGround, string> = {
		tooTrivial: '너무 단순함',
		nonLexical: '어휘 항목이 아님',
		properNoun: '고유명사',
		tooSpecialized: '지나치게 전문적',
		overlyLong: '지나치게 김',
		offensive: '부적절한 표현',
		obsolete: '사어·구식 표현',
		ambiguous: '의미가 모호함',
		other: '기타'
	};
	const partOfSpeechLabels: Record<PartOfSpeech, string> = {
		interjection: '감탄사',
		determiner: '관형사',
		pronoun: '대명사',
		verb: '동사',
		noun: '명사',
		adverb: '부사',
		numeral: '수사',
		adjective: '형용사'
	};
	const vocaFields: Array<{ key: keyof QuizReportVocaSnapshot; label: string }> = [
		{ key: 'sourceText', label: '한국어' },
		{ key: 'sourceDefinition', label: '한국어 뜻' },
		{ key: 'partOfSpeech', label: '품사' },
		{ key: 'targetText', label: '대상어' },
		{ key: 'targetDefinition', label: '대상어 뜻' },
		{ key: 'difficultyLevel', label: '난이도' },
		{ key: 'utilityScore', label: '활용도' }
	];

	function revealAnswer(template: string, fillText: string): string {
		return template.replace('{{---}}', fillText);
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat('ko-KR', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	function showPending(reportId: string, message: string): SubmitFunction {
		return () => {
			pendingReportId = reportId;
			pendingMessage = message;
			return async ({ update }) => {
				try {
					await update();
				} finally {
					pendingReportId = null;
					pendingMessage = '';
				}
			};
		};
	}

	function toggleSnapshot(reportId: string): void {
		visibleSnapshots = { ...visibleSnapshots, [reportId]: !visibleSnapshots[reportId] };
	}
</script>

<svelte:head><title>신고 관리 | word-quest</title></svelte:head>

<header class="page-heading">
	<div>
		<p class="eyebrow">관리자</p>
		<h1>신고 관리</h1>
		<p>AI 검토 결과를 확인하고 권장 처리하거나, 필요할 때만 세부 내용을 조정합니다.</p>
	</div>
	<strong class="report-count">{data.reports.length}<span>건 대기</span></strong>
</header>

{#if form?.success}
	<p class="notice success" role="status">{form.message}</p>
{:else if form?.error}
	<aside class="post-it notice error" role="alert">{form.error}</aside>
{/if}

{#if data.reports.length === 0}
	<section class="empty-state">
		<h2>처리할 신고가 없습니다</h2>
		<p>새 신고가 들어오면 이곳에 표시됩니다.</p>
	</section>
{:else}
	<section class="report-list" aria-label="처리 대기 신고">
		{#each data.reports as item (item.report._id)}
			{@const proposal = item.report.proposalAttempts.at(-1)}
			{@const currentVoca = item.voca}
			{@const isPending = pendingReportId === item.report._id}
			{@const snapshotVisible = visibleSnapshots[item.report._id] === true}
			<article class="report-card" aria-busy={isPending}>
				<header class="report-meta">
					<div class="badges">
						{#each item.report.issues as issue (issue)}
							<span class="issue">{issueLabels[issue]}</span>
						{/each}
					</div>
					<time datetime={item.report.createdAt}>{formatDate(item.report.createdAt)}</time>
				</header>

				{#if isPending}
					<div class="processing" role="status" aria-live="polite">
						<span class="spinner" aria-hidden="true"></span>
						<div>
							<strong>{pendingMessage}</strong>
							<small>결과가 도착하면 이 화면에 바로 표시됩니다.</small>
						</div>
					</div>
				{/if}

				<div class="comparison-toolbar">
					<button
						class="snapshot-toggle"
						type="button"
						aria-expanded={snapshotVisible}
						onclick={() => toggleSnapshot(item.report._id)}
						>{snapshotVisible ? '신고 당시 내용 숨기기' : '신고 당시 내용 보기'}</button
					>
				</div>

				<div class="comparison" class:three-way={snapshotVisible && proposal != null}>
					{#if snapshotVisible}
						<section>
							<h2>신고 당시</h2>
							<dl>
								{#each vocaFields as field (field.key)}
									<div>
										<dt>{field.label}</dt>
										<dd>{item.report.vocaSnapshot[field.key] ?? '—'}</dd>
									</div>
								{/each}
							</dl>
							<p>
								{revealAnswer(
									item.report.quizExampleSnapshot.sourceSentenceTemplate,
									item.report.quizExampleSnapshot.sourceFillText
								)}
							</p>
							<p>
								{revealAnswer(
									item.report.quizExampleSnapshot.targetSentenceTemplate,
									item.report.quizExampleSnapshot.targetFillText
								)}
							</p>
							<small>발음 {item.report.quizExampleSnapshot.targetPronunciationText}</small>
						</section>
					{/if}

					<section>
						<h2>현재 단어·예문</h2>
						{#if currentVoca}
							<dl>
								{#each vocaFields as field (field.key)}
									<div>
										<dt>{field.label}</dt>
										<dd>{currentVoca[field.key] ?? '—'}</dd>
									</div>
								{/each}
							</dl>
						{:else}<p class="missing">현재 단어를 찾을 수 없습니다.</p>{/if}
						{#if item.currentExample}
							<p>
								{revealAnswer(
									item.currentExample.sourceSentenceTemplate,
									item.currentExample.sourceFillText
								)}
							</p>
							<p>
								{revealAnswer(
									item.currentExample.targetSentenceTemplate,
									item.currentExample.targetFillText
								)}
							</p>
							<small>발음 {item.currentExample.targetPronunciationText}</small>
						{:else}<p class="missing">현재 예문을 찾을 수 없습니다.</p>{/if}
					</section>

					{#if proposal}
						<section class="proposal">
							<h2>AI 제안 · {recommendationLabels[proposal.recommendation]}</h2>
							<dl>
								{#each vocaFields as field (field.key)}
									{#if currentVoca?.[field.key] !== proposal.proposedVoca[field.key]}
										<div class="changed">
											<dt>{field.label}</dt>
											<dd>{proposal.proposedVoca[field.key] ?? '—'}</dd>
										</div>
									{/if}
								{/each}
							</dl>
							{#if item.currentExample?.sourceSentenceTemplate !== proposal.proposedExample.sourceSentenceTemplate || item.currentExample?.sourceFillText !== proposal.proposedExample.sourceFillText}
								<p class="changed">
									{revealAnswer(
										proposal.proposedExample.sourceSentenceTemplate,
										proposal.proposedExample.sourceFillText
									)}
								</p>
							{/if}
							{#if item.currentExample?.targetSentenceTemplate !== proposal.proposedExample.targetSentenceTemplate || item.currentExample?.targetFillText !== proposal.proposedExample.targetFillText}
								<p class="changed">
									{revealAnswer(
										proposal.proposedExample.targetSentenceTemplate,
										proposal.proposedExample.targetFillText
									)}
								</p>
							{/if}
							{#if item.currentExample?.targetPronunciationText !== proposal.proposedExample.targetPronunciationText}
								<small class="changed"
									>발음 {proposal.proposedExample.targetPronunciationText}</small
								>
							{/if}
							<div class="proposal-summary">
								<p>{proposal.explanation}</p>
								{#if proposal.grounds.length > 0}<small
										>근거: {proposal.grounds
											.map((ground) => groundLabels[ground])
											.join(', ')}</small
									>{/if}
								{#if proposal.suggestedRepair}<small>수정 방향: {proposal.suggestedRepair}</small
									>{/if}
							</div>
						</section>
					{/if}
				</div>

				{#if item.report.details}
					<section class="reporter-message">
						<strong>신고자가 남긴 메시지</strong>
						<blockquote>{item.report.details}</blockquote>
					</section>
				{/if}

				{#if proposal}
					<section class="resolution-panel">
						<header>
							<strong>처리</strong>
							<small>AI 권고와 다른 선택을 할 때는 관리자 메모를 남겨 주세요.</small>
						</header>
						<form
							class="resolution-form"
							method="POST"
							use:enhance={showPending(item.report._id, '신고를 처리하고 있어요')}
						>
							<input type="hidden" name="reportId" value={item.report._id} />
							<label>
								<span>관리자 메모</span>
								<input name="note" maxlength="500" placeholder="선택 사항" />
							</label>
							<div class="resolution-actions">
								<button
									class="button"
									type="submit"
									formaction={proposal.recommendation === 'repair'
										? '?/accept'
										: proposal.recommendation === 'keep'
											? '?/dismiss'
											: '?/exclude'}
									disabled={isPending ||
										(proposal.recommendation === 'repair' &&
											(!currentVoca || !item.currentExample)) ||
										(proposal.recommendation === 'exclude' && !currentVoca)}
									onclick={(event) => {
										if (
											proposal.recommendation !== 'keep' &&
											!confirm('AI가 권장한 처리 방법을 수용할까요?')
										)
											event.preventDefault();
									}}>AI 제안 수용</button
								>
								<button
									class="button secondary"
									type="submit"
									formaction="?/dismiss"
									disabled={isPending}>기각</button
								>
								<button
									class="button danger"
									type="submit"
									formaction="?/deleteExample"
									disabled={isPending || !item.currentExample}
									onclick={(event) => {
										if (!confirm('신고된 예문을 삭제할까요?')) event.preventDefault();
									}}>예문 삭제</button
								>
								<button
									class="button danger"
									type="submit"
									formaction="?/exclude"
									disabled={isPending || !currentVoca}
									onclick={(event) => {
										if (!confirm('이 단어를 모든 퀴즈에서 영구 제외할까요?'))
											event.preventDefault();
									}}>단어 영구 제외</button
								>
							</div>
						</form>
					</section>

					<details class="advanced-actions">
						<summary>AI 제안 조정</summary>
						<div class="advanced-content">
							<form
								class="ai-message"
								method="POST"
								action="?/retry"
								use:enhance={showPending(
									item.report._id,
									'AI가 요청을 반영해 새 제안을 만들고 있어요'
								)}
							>
								<input type="hidden" name="reportId" value={item.report._id} />
								<label>
									<span>AI에게 수정 요청</span>
									<textarea
										name="instruction"
										maxlength="500"
										required
										rows="2"
										placeholder="예: 단어와 뜻은 그대로 두고 발음 표기만 더 자연스럽게 고쳐줘"
									></textarea>
								</label>
								<button class="button secondary" type="submit" disabled={isPending}
									>{isPending ? '새 제안 생성 중…' : '메시지 보내고 다시 생성'}</button
								>
							</form>

							<details class="manual-actions">
								<summary>필드를 직접 수정</summary>
								<div class="manual-content">
									<form class="draft-editor" method="POST" action="?/apply">
										<input type="hidden" name="reportId" value={item.report._id} />
										<input type="hidden" name="proposalAttemptId" value={proposal._id} />
										<input
											type="hidden"
											name="targetLang"
											value={proposal.proposedVoca.targetLang}
										/>
										<header>
											<div>
												<h2>관리자 적용안</h2>
												<p>적용할 영역만 선택하고 AI 초안을 직접 수정하세요.</p>
											</div>
											<small>체크하지 않은 영역은 운영 데이터에 반영되지 않습니다.</small>
										</header>

										<fieldset>
											<label class="section-toggle">
												<input
													type="checkbox"
													name="sections"
													value={QUIZ_REPORT_APPLY_SECTIONS.VOCA}
													checked={currentVoca != null &&
														(
															[
																'sourceText',
																'sourceDefinition',
																'partOfSpeech',
																'targetText',
																'targetDefinition'
															] as const
														).some((field) => currentVoca[field] !== proposal.proposedVoca[field])}
												/>
												<strong>단어·뜻 적용</strong>
											</label>
											<div class="field-grid">
												<label
													>한국어 <input
														name="sourceText"
														value={proposal.proposedVoca.sourceText}
														required
													/></label
												>
												<label
													>한국어 뜻 <input
														name="sourceDefinition"
														value={proposal.proposedVoca.sourceDefinition}
														required
													/></label
												>
												<label
													>품사 <select name="partOfSpeech"
														>{#each Object.values(PARTS_OF_SPEECH) as part (part)}<option
																value={part}
																selected={part === proposal.proposedVoca.partOfSpeech}
																>{partOfSpeechLabels[part]}</option
															>{/each}</select
													></label
												>
												<label
													>대상어 <input
														name="targetText"
														value={proposal.proposedVoca.targetText}
														required
													/></label
												>
												<label
													>대상어 뜻 <input
														name="targetDefinition"
														value={proposal.proposedVoca.targetDefinition}
														required
													/></label
												>
											</div>
										</fieldset>

										<div class="score-grid">
											<fieldset>
												<label class="section-toggle"
													><input
														type="checkbox"
														name="sections"
														value={QUIZ_REPORT_APPLY_SECTIONS.DIFFICULTY}
														checked={currentVoca?.difficultyLevel !==
															proposal.proposedVoca.difficultyLevel}
													/><strong>난이도만 적용</strong></label
												>
												<label
													>난이도 (1–10) <input
														type="number"
														name="difficultyLevel"
														min="1"
														max="10"
														value={proposal.proposedVoca.difficultyLevel ?? ''}
													/></label
												>
											</fieldset>
											<fieldset>
												<label class="section-toggle"
													><input
														type="checkbox"
														name="sections"
														value={QUIZ_REPORT_APPLY_SECTIONS.UTILITY}
														checked={currentVoca?.utilityScore !==
															proposal.proposedVoca.utilityScore}
													/><strong>활용도만 적용</strong></label
												>
												<label
													>활용도 (0–5) <input
														type="number"
														name="utilityScore"
														min="0"
														max="5"
														value={proposal.proposedVoca.utilityScore ?? ''}
													/></label
												>
											</fieldset>
										</div>

										<fieldset>
											<label class="section-toggle">
												<input
													type="checkbox"
													name="sections"
													value={QUIZ_REPORT_APPLY_SECTIONS.EXAMPLE}
													checked={item.currentExample != null &&
														(
															[
																'sourceSentenceTemplate',
																'sourceFillText',
																'targetSentenceTemplate',
																'targetFillText',
																'targetPronunciationText'
															] as const
														).some(
															(field) =>
																item.currentExample?.[field] !== proposal.proposedExample[field]
														)}
												/>
												<strong>예문 적용</strong>
											</label>
											<div class="field-grid example-fields">
												<label
													>한국어 문장 템플릿 <textarea name="sourceSentenceTemplate" required
														>{proposal.proposedExample.sourceSentenceTemplate}</textarea
													></label
												>
												<label
													>한국어 정답 <input
														name="sourceFillText"
														value={proposal.proposedExample.sourceFillText}
														required
													/></label
												>
												<label
													>대상어 문장 템플릿 <textarea name="targetSentenceTemplate" required
														>{proposal.proposedExample.targetSentenceTemplate}</textarea
													></label
												>
												<label
													>대상어 정답 <input
														name="targetFillText"
														value={proposal.proposedExample.targetFillText}
														required
													/></label
												>
												<label
													>대상어 발음 <input
														name="targetPronunciationText"
														value={proposal.proposedExample.targetPronunciationText}
														required
													/></label
												>
											</div>
										</fieldset>

										<label
											>관리자 메모 <input
												name="note"
												maxlength="500"
												placeholder="AI 권고와 다르게 처리할 때 필수"
											/></label
										>
										<button
											class="button"
											type="submit"
											disabled={isPending || !currentVoca || !item.currentExample}
											onclick={(event) => {
												if (!confirm('선택하고 편집한 항목을 운영 데이터에 적용할까요?'))
													event.preventDefault();
											}}>선택한 수정 적용</button
										>
									</form>
								</div>
							</details>
						</div>
					</details>
				{:else}
					<section class="pre-review-panel">
						<header>
							<strong>처리 방법 선택</strong>
							<p>AI 검토를 먼저 받거나, 검토 없이 바로 처리할 수 있습니다.</p>
						</header>
						<div class="pre-review-actions">
							<form
								class="generate"
								method="POST"
								action="?/generate"
								use:enhance={showPending(item.report._id, 'AI가 신고 내용을 분석하고 있어요')}
							>
								<input type="hidden" name="reportId" value={item.report._id} />
								{#if item.report.issues.includes('other') && !item.report.details}
									<label>
										AI에게 확인시킬 내용
										<input
											name="instruction"
											maxlength="500"
											required
											placeholder="기타 신고 내용을 입력해 주세요"
										/>
									</label>
								{/if}
								<button
									class="button"
									type="submit"
									disabled={isPending || !currentVoca || !item.currentExample}
									>{isPending ? '분석 중…' : 'AI로 검토'}</button
								>
							</form>

							<form
								class="quick-decision"
								method="POST"
								use:enhance={showPending(item.report._id, '신고를 처리하고 있어요')}
							>
								<input type="hidden" name="reportId" value={item.report._id} />
								<div class="resolution-actions">
									<button
										class="button secondary"
										type="submit"
										formaction="?/dismiss"
										disabled={isPending}>기각</button
									>
									<button
										class="button danger"
										type="submit"
										formaction="?/deleteExample"
										disabled={isPending || !item.currentExample}
										onclick={(event) => {
											if (!confirm('AI 검토 없이 신고된 예문을 삭제할까요?'))
												event.preventDefault();
										}}>예문 삭제</button
									>
									<button
										class="button danger"
										type="submit"
										formaction="?/exclude"
										disabled={isPending || !currentVoca}
										onclick={(event) => {
											if (!confirm('AI 검토 없이 이 단어를 모든 퀴즈에서 영구 제외할까요?'))
												event.preventDefault();
										}}>단어 영구 제외</button
									>
								</div>
							</form>
						</div>
					</section>
				{/if}

				<footer>
					신고자 {item.reporter?.name ?? '알 수 없음'} · {item.reporter?.email ??
						item.report.userId}
				</footer>
			</article>
		{/each}
	</section>
{/if}

<style>
	.page-heading,
	.report-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-4);
	}
	.page-heading {
		align-items: end;
		margin-bottom: var(--spacing-6);
	}
	.page-heading :is(h1, p),
	.report-card :is(h2, p),
	blockquote,
	dl,
	dd {
		margin: 0;
	}
	.page-heading > div > p:last-child,
	time,
	footer {
		color: var(--ink-soft);
	}
	.eyebrow {
		font-size: var(--text-sm);
		font-weight: 800;
		color: var(--red);
		letter-spacing: 0.08em;
	}
	.report-count {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-1);
		font-size: var(--text-4xl);
		color: var(--brown);
	}
	.report-count span,
	time,
	footer {
		font-size: var(--text-sm);
	}
	.notice,
	.empty-state {
		padding: var(--spacing-4);
		background: var(--paper-soft);
	}
	.notice.success {
		color: var(--green-strong);
		background: var(--green);
	}
	.notice.error,
	.missing {
		color: var(--red);
		background: var(--red-soft);
	}
	.processing {
		display: flex;
		align-items: center;
		gap: var(--spacing-3);
		padding: var(--spacing-4);
		color: var(--brown);
		background: var(--yellow);
	}
	.processing > div {
		display: grid;
		gap: var(--spacing-1);
	}
	.processing small {
		color: var(--ink-soft);
	}
	.spinner {
		width: 1.5rem;
		height: 1.5rem;
		border: 0.2rem solid color-mix(in srgb, var(--brown) 25%, transparent);
		border-top-color: var(--brown);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.empty-state {
		padding-block: var(--spacing-16);
		text-align: center;
	}
	.report-list,
	.report-card,
	.draft-editor,
	.ai-message,
	.reporter-message {
		display: grid;
		gap: var(--spacing-4);
	}
	.report-card {
		padding: var(--spacing-5);
		background: var(--paper-soft);
		box-shadow: 0 0.3rem 0.85rem var(--shadow-soft);
	}
	.badges,
	.resolution-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-start;
		gap: var(--spacing-2);
	}
	.issue {
		padding: var(--spacing-1) var(--spacing-3);
		font-size: var(--text-sm);
		font-weight: 800;
		color: var(--red);
		background: var(--rose);
	}
	blockquote {
		padding: var(--spacing-3) var(--spacing-4);
		border-left: 0.2rem solid var(--line-red);
		background: var(--paper);
		font-style: normal;
	}
	.comparison-toolbar {
		display: flex;
		justify-content: flex-end;
	}
	.snapshot-toggle {
		padding: 0;
		border: 0;
		color: var(--brown);
		background: transparent;
		font: inherit;
		font-weight: 800;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
	.comparison {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
		gap: var(--spacing-3);
	}
	.comparison.three-way {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.comparison > section {
		display: grid;
		align-content: start;
		gap: var(--spacing-3);
		padding: var(--spacing-4);
		background: var(--paper);
	}
	.comparison h2 {
		font-size: var(--text-lg);
	}
	dl {
		display: grid;
		gap: var(--spacing-1);
	}
	dl div {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr);
		gap: var(--spacing-2);
		padding: var(--spacing-1);
	}
	dt {
		color: var(--ink-soft);
	}
	.changed {
		padding: var(--spacing-2);
		color: var(--green-strong);
		background: var(--green);
	}
	.proposal-summary {
		display: grid;
		gap: var(--spacing-1);
		padding-top: var(--spacing-2);
		border-top: 0.1rem solid var(--line);
	}
	.proposal-summary small {
		color: var(--ink-soft);
	}
	.resolution-panel,
	.pre-review-panel,
	.resolution-form {
		display: grid;
		gap: var(--spacing-4);
	}
	.resolution-panel,
	.pre-review-panel {
		padding: var(--spacing-4);
		background: var(--paper);
		border: 0.12rem solid var(--line);
	}
	.pre-review-panel > header {
		display: grid;
		gap: var(--spacing-1);
	}
	.pre-review-actions {
		display: grid;
		gap: var(--spacing-4);
	}
	.resolution-panel > header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: var(--spacing-3);
	}
	.resolution-panel > header small {
		color: var(--ink-soft);
	}
	.resolution-form label {
		display: grid;
		gap: var(--spacing-1);
		font-size: var(--text-sm);
	}
	.resolution-form input {
		width: 100%;
		padding: var(--spacing-2);
		border: 0.1rem solid var(--line);
		background: var(--paper-soft);
		font: inherit;
	}
	.advanced-actions,
	.manual-actions {
		background: var(--paper);
		border: 0.1rem solid var(--line);
	}
	.advanced-actions > summary,
	.manual-actions > summary {
		padding: var(--spacing-4);
		font-weight: 800;
		cursor: pointer;
	}
	.advanced-actions[open] > summary,
	.manual-actions[open] > summary {
		border-bottom: 0.1rem solid var(--line);
	}
	.advanced-content,
	.manual-content {
		display: grid;
		gap: var(--spacing-4);
		padding: var(--spacing-4);
	}
	.draft-editor {
		padding: var(--spacing-4);
		background: var(--paper);
		border: 0.12rem solid var(--line);
	}
	.draft-editor > header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: var(--spacing-3);
	}
	.draft-editor fieldset {
		display: grid;
		gap: var(--spacing-3);
		margin: 0;
		padding: var(--spacing-3);
		border: 0.1rem solid var(--line);
	}
	.section-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-2);
	}
	.field-grid,
	.score-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--spacing-3);
	}
	.example-fields label:first-child,
	.example-fields label:nth-child(3) {
		grid-column: 1 / -1;
	}
	.draft-editor label:not(.section-toggle) {
		display: grid;
		gap: var(--spacing-1);
		font-size: var(--text-sm);
	}
	.draft-editor :is(input:not([type='checkbox']), select, textarea) {
		width: 100%;
		padding: var(--spacing-2);
		border: 0.1rem solid var(--line);
		background: var(--paper-soft);
		font: inherit;
	}
	.draft-editor textarea {
		min-height: 5rem;
		resize: vertical;
	}
	.ai-message {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
	}
	.ai-message label {
		display: grid;
		gap: var(--spacing-1);
		font-size: var(--text-sm);
	}
	.ai-message textarea {
		width: 100%;
		padding: var(--spacing-2);
		border: 0.1rem solid var(--line);
		background: var(--paper);
		font: inherit;
	}
	.ai-message textarea {
		min-height: 4.5rem;
		resize: vertical;
	}
	.button.danger {
		color: var(--paper);
		background: var(--red);
	}
	.generate {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
		gap: var(--spacing-4);
	}
	.generate label {
		display: grid;
		gap: var(--spacing-1);
		font-size: var(--text-sm);
	}
	.generate input {
		width: 100%;
		padding: var(--spacing-2);
		border: 0.1rem solid var(--line);
		background: var(--paper);
		font: inherit;
	}
	@media (max-width: 48rem) {
		.page-heading,
		.report-meta,
		.ai-message,
		.generate {
			grid-template-columns: 1fr;
			display: grid;
		}
		.resolution-panel > header {
			display: grid;
		}
		.comparison.three-way {
			grid-template-columns: 1fr;
		}
		.resolution-actions {
			justify-content: flex-start;
		}
		.draft-editor > header,
		.field-grid,
		.score-grid {
			display: grid;
			grid-template-columns: 1fr;
		}
		.example-fields label:first-child,
		.example-fields label:nth-child(3) {
			grid-column: auto;
		}
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
