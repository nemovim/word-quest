<script lang="ts">
	import QuizModule from './_components/quizModule.svelte';
	let { data } = $props();
</script>

<QuizModule pageData={data} game={data.game} />
