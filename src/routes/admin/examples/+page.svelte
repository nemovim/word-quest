<script lang="ts">
	import type { ActionData, PageData } from './$types';

	import { enhance } from '$app/forms';
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const labels: Record<string, string> = {
		korean: '한국어',
		target: '대상 언어',
		matching: '의미 일치',
		pronunciation: '발음'
	};
</script>

<svelte:head><title>보류 예문 · Word Quest</title></svelte:head>
<section class="page">
	<header>
		<div>
			<h1>보류 예문</h1>
			<p>불확실한 예문을 다시 검토하거나 수정해 승인할 수 있어요. 목록은 최대 100개입니다.</p>
		</div>
		<form method="POST" action="?/retryAll" use:enhance>
			<button>보류 예문 재검토 (최대 25개)</button>
		</form>
	</header>
	{#if form?.message}<p role="status" class="message">{form.message}</p>{/if}
	{#if data.examples.length === 0}<p>보류된 예문이 없어요.</p>{/if}
	{#each data.examples as item (item._id)}
		<article>
			<h2>{item.input.sourceText} · {item.input.targetText}</h2>
			<p>{item.input.sourceDefinition} / {item.input.targetDefinition}</p>
			{#each item.history.slice(-1) as record (record.at.toString())}
				{#if record.reason?.startsWith('cmudict_missing:')}
					<p>CMUdict에 없는 단어: {record.reason.slice('cmudict_missing:'.length)}</p>
				{:else if record.reason === 'cmudict_selection_uncertain'}
					<p>문맥에 맞는 사전 발음을 선택하지 못했습니다.</p>
				{:else if record.reason === 'example_review_uncertain'}
					<p>예문 또는 빈칸의 의미 일치 여부가 불확실합니다.</p>
				{/if}
				{#each record.attempts as attempt (attempt.model)}
					<p class="evidence">
						<strong>{attempt.model}</strong>
						{#if attempt.verdict}<span>검토: {attempt.verdict}</span>{/if}
						{#each Object.entries(attempt.probabilities) as [key, value] (key)}<span
								>{labels[key] ?? key}: {typeof value === 'number' ? value.toFixed(2) : '-'}</span
							>{/each}
					</p>
				{/each}
			{/each}
			<form method="POST" action="?/approve" use:enhance>
				<input type="hidden" name="id" value={item._id} />
				<label
					>한국어 문장<input
						name="sourceSentence"
						value={item.input.sourceSentence}
						required
					/></label
				>
				<label
					>한국어 빈칸<input name="sourceAnswer" value={item.input.sourceAnswer} required /></label
				>
				<label
					>대상 언어 문장<input
						name="targetSentence"
						value={item.input.targetSentence}
						required
					/></label
				>
				<label
					>대상 언어 빈칸<input
						name="targetAnswer"
						value={item.input.targetAnswer}
						required
					/></label
				>
				<label
					>발음<input
						name="targetPronunciation"
						value={item.input.targetPronunciation}
						required
					/></label
				>
				<button type="submit">수정 후 승인</button>
			</form>
			<div class="actions">
				<form method="POST" action="?/retry" use:enhance>
					<input type="hidden" name="id" value={item._id} /><button>다시 검토</button>
				</form>
				<form method="POST" action="?/reject" use:enhance>
					<input type="hidden" name="id" value={item._id} /><button>제외</button>
				</form>
			</div>
		</article>
	{/each}
</section>

<style>
	.page {
		max-width: 900px;
		margin: 2rem auto;
		padding: 0 1rem;
	}
	header {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	h1 {
		margin-bottom: 0.3rem;
	}
	h2 {
		font-size: 1.15rem;
	}
	article {
		background: white;
		border: 1px solid #ddd;
		border-radius: 12px;
		padding: 1rem;
		margin: 1rem 0;
	}
	label {
		display: block;
		margin: 0.6rem 0;
		font-size: 0.9rem;
	}
	input:not([type='hidden']) {
		display: block;
		box-sizing: border-box;
		width: 100%;
		padding: 0.55rem;
		margin-top: 0.2rem;
	}
	button {
		cursor: pointer;
		padding: 0.55rem 0.8rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	.evidence {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		font-size: 0.85rem;
	}
	.message {
		font-weight: bold;
	}
</style>
