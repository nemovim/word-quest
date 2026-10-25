<script lang="ts">
	import type { AddContextValues } from '../add-view';
	import type { SubmitFunction } from '@sveltejs/kit';

	import { enhance } from '$app/forms';

	let {
		context,
		searchedText,
		onCancel,
		error
	}: {
		context: AddContextValues;
		searchedText: string;
		onCancel: () => void;
		error?: string;
	} = $props();

	let isGenerating = $state(false);
	const isKoreanSearch = $derived(/[가-힣ㄱ-ㅣ]/.test(searchedText));

	const generateExamples: SubmitFunction = () => {
		isGenerating = true;

		return async ({ update }) => {
			try {
				await update();
			} finally {
				isGenerating = false;
			}
		};
	};
</script>

<form
	method="POST"
	action="?/create"
	class="add-card"
	aria-busy={isGenerating}
	use:enhance={generateExamples}
>
	<h2>직접 추가하기</h2>
	<p class="add-hint">원하는 단어나 뜻이 사전에 없다면 직접 추가할 수 있어요.</p>

	<label class="field">
		<span>검색한 단어 또는 표현</span>
		<input
			name={isKoreanSearch ? 'sourceText' : 'targetText'}
			value={searchedText}
			maxlength="150"
			readonly
			required
		/>
	</label>

	<input name="targetLang" type="hidden" value="en" />

	<label class="field">
		<span>{isKoreanSearch ? '외울 영어 단어 또는 표현' : '대응하는 한국어 단어 또는 표현'}</span>
		<input
			name={isKoreanSearch ? 'targetText' : 'sourceText'}
			value={isKoreanSearch
				? context.targetText
				: context.targetText === searchedText
					? context.sourceText
					: ''}
			maxlength={isKoreanSearch ? 150 : 100}
			disabled={isGenerating}
			required
		/>
	</label>

	<label class="field">
		<span>뜻 힌트</span>
		<textarea
			name="meaningHint"
			rows="3"
			maxlength="500"
			disabled={isGenerating}
			required
			placeholder="예: 한 장소에서 다른 장소로 움직인다는 뜻의 동사">{context.meaningHint}</textarea
		>
	</label>

	<p class="add-hint">같은 뜻의 단어가 이미 있다면 중복으로 만들지 않고 기존 단어를 사용해요.</p>

	{#if error}
		<aside class="post-it add-error" role="alert">{error}</aside>
	{/if}

	<div class="create-actions">
		<button type="button" class="button secondary" onclick={onCancel} disabled={isGenerating}>
			취소하기
		</button>
		<button class="button" type="submit" disabled={isGenerating}>
			{isGenerating ? '검증하고 만드는 중…' : '검증하고 예문 만들기'}
		</button>
	</div>
</form>

<style>
	.create-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--spacing-3);
	}
</style>
