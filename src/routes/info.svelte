<script lang="ts">
	let { email }: { email: string } = $props();

	const today = new Date();
	const date = new Intl.DateTimeFormat('ko-KR', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	}).format(today);
</script>

<aside aria-label="사용자 정보">
	<span>{email}</span>
	<time datetime={today.toISOString().slice(0, 10)}>{date}</time>
</aside>

<style>
	aside {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--spacing-4);
		margin-bottom: var(--spacing-6);
		padding-bottom: var(--spacing-2);
		border-bottom: 0.1rem solid var(--line);
		font-size: var(--text-sm);
		color: var(--ink-soft);
	}

	aside span {
		overflow-wrap: anywhere;
	}
</style>
