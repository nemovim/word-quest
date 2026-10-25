<script lang="ts">
	import { LANGUAGE_CODES } from '$lib/shared/types/general.type';

	let {
		sourceText,
		label = '한국어 또는 영어 단어',
		readonly = false,
		disabled = false
	}: {
		sourceText: string;
		label?: string;
		readonly?: boolean;
		disabled?: boolean;
	} = $props();
</script>

<label class="field">
	<span>{label}</span>
	<input
		name="sourceText"
		value={sourceText}
		placeholder="예: 나무 또는 tree"
		autocomplete="off"
		maxlength="100"
		pattern=".*[A-Za-z가-힣ㄱ-ㅣ].*"
		title="한글이나 영문을 하나 이상 입력해 주세요."
		{readonly}
		{disabled}
		required
	/>
</label>

<input name="targetLang" type="hidden" value={LANGUAGE_CODES.EN} />
