<script lang="ts">
	import type { AddContextValues } from '../add-view';

	let { context }: { context: AddContextValues } = $props();
</script>

<input name="sourceText" type="hidden" value={context.sourceText} />
<input name="targetLang" type="hidden" value={context.targetLang} />
<input name="targetText" type="hidden" value={context.targetText} />
<input name="meaningHint" type="hidden" value={context.meaningHint} />
