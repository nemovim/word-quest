<script lang="ts">
	import type { MonsterKind } from '$lib/shared/types/journey.type';
	let { boss = false, kind = 'slime' }: { boss?: boolean; kind?: MonsterKind } = $props();
</script>

<svg viewBox="0 0 120 110" fill="none" aria-hidden="true" class:boss>
	<ellipse cx="60" cy="98" rx="40" ry="7" fill="#9c7044" opacity=".15" />
	<g class="creature">
		{#if !boss && kind === 'mushroom'}
			<path d="M40 47h40l7 40q-27 17-54 0Z" fill="#efdab6" stroke="#a77c54" stroke-width="2.5" />
			<path
				d="M14 48Q20 10 60 12Q100 10 106 48Q60 62 14 48Z"
				fill="#b57c51"
				stroke="#805738"
				stroke-width="2.5"
			/>
			<ellipse cx="39" cy="32" rx="8" ry="6" fill="#f3d7a4" /><ellipse
				cx="76"
				cy="27"
				rx="9"
				ry="6"
				fill="#f3d7a4"
			/><circle cx="91" cy="42" r="4" fill="#f3d7a4" />
		{:else if !boss && kind === 'bat'}
			<path
				d="M43 53Q18 24 6 40L11 78Q24 63 41 85M77 53Q102 24 114 40L109 78Q96 63 79 85"
				fill="#af9279"
				stroke="#785d49"
				stroke-width="2.5"
			/>
			<path
				d="M35 52 35 20 52 37Q60 34 68 37L85 20V52Q96 89 60 94Q24 89 35 52Z"
				fill="#c6a180"
				stroke="#785d49"
				stroke-width="2.5"
			/>
			<path d="m40 32 7 11m33-11-7 11" stroke="#eed1ae" stroke-width="4" stroke-linecap="round" />
		{:else if !boss && kind === 'golem'}
			<path
				d="m19 53-10 9 3 23 14 2 6-25m69-9 10 9-3 23-14 2-6-25"
				fill="#ad9981"
				stroke="#806d58"
				stroke-width="2.5"
			/>
			<path
				d="m37 24 42-3 16 20-3 43-18 13-39-4-12-19 3-33Z"
				fill="#c7b59b"
				stroke="#806d58"
				stroke-width="2.5"
			/>
			<path
				d="m45 25 7 13-9 9m44 30-11 4 3 13"
				stroke="#9c856b"
				stroke-width="3"
				stroke-linecap="round"
			/>
			<path d="m54 26 6-6 6 6-6 7Z" fill="#eed29b" />
		{:else}
			<ellipse cx="35" cy="91" rx="13" ry="8" fill={boss ? '#93603c' : '#ba8954'} />
			<ellipse cx="85" cy="91" rx="13" ry="8" fill={boss ? '#93603c' : '#ba8954'} />
			{#if boss}
				<path
					d="M27 42Q11 31 22 15Q23 31 40 30M93 42Q109 31 98 15Q97 31 80 30"
					fill="#f4dfb4"
					stroke="#8b613d"
					stroke-width="3"
					stroke-linejoin="round"
				/>
			{/if}
			<path
				d="M18 76C18 52 28 29 47 27Q58 26 64 16Q71 23 70 29C91 30 102 52 102 76Q103 94 82 95H38Q17 94 18 76Z"
				fill={boss ? '#b8814c' : '#dcaf72'}
				stroke={boss ? '#7e4f30' : '#a77745'}
				stroke-width="2.5"
				stroke-linejoin="round"
			/>
			<path
				d="M24 78Q30 89 43 88H78Q93 88 97 78Q98 91 81 92H39Q25 92 24 78Z"
				fill={boss ? '#996439' : '#c29259'}
			/>
			<path
				d="M33 48Q39 36 49 36"
				stroke="#ffe9bd"
				stroke-width="6"
				stroke-linecap="round"
				opacity=".8"
			/>
			<ellipse cx="32" cy="72" rx="8" ry="4" fill="#d98c64" opacity=".6" />
			<ellipse cx="88" cy="72" rx="8" ry="4" fill="#d98c64" opacity=".6" />
		{/if}
		<g class="eyes">
			<ellipse cx="44" cy="61" rx="5" ry="8" fill="#4c3425" />
			<ellipse cx="76" cy="61" rx="5" ry="8" fill="#4c3425" />
			<circle cx="45.5" cy="58" r="1.8" fill="#fff8e6" />
			<circle cx="77.5" cy="58" r="1.8" fill="#fff8e6" />
		</g>
		{#if boss}
			<path d="m38 48 11 4m22 0 11-4" stroke="#68412b" stroke-width="3.5" stroke-linecap="round" />
			<path
				d="M51 74Q60 82 69 74"
				fill="#68412b"
				stroke="#68412b"
				stroke-width="2"
				stroke-linejoin="round"
			/>
			<path d="m53 75 3 6 3-5m3 0 3 5 3-6" fill="#fff3d5" />
			<path d="m54 32 6-7 6 7-6 7Z" fill="#f7da88" stroke="#8e5e34" stroke-width="1.5" />
		{:else}
			<path d="M53 74Q60 81 67 74" stroke="#775033" stroke-width="3" stroke-linecap="round" />
		{/if}
	</g>
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.creature {
		transform-origin: 60px 95px;
		animation: breathe 3s ease-in-out infinite;
	}
	.boss .creature {
		animation-duration: 3.8s;
	}
	.eyes {
		transform-origin: 60px 61px;
		animation: blink 5.5s infinite;
	}
	@keyframes breathe {
		50% {
			transform: translateY(-2px) scale(1.025, 0.975);
		}
	}
	@keyframes blink {
		0%,
		44%,
		48%,
		100% {
			transform: scaleY(1);
		}
		46% {
			transform: scaleY(0.1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.creature,
		.eyes {
			animation: none;
		}
	}
</style>
