import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

const noPadding = { padding: 0 };

export default defineConfig({
	headLinkOptions: {
		preset: '2023'
	},
	preset: {
		...minimal2023Preset,
		transparent: {
			...minimal2023Preset.transparent,
			...noPadding
		},
		maskable: {
			...minimal2023Preset.maskable,
			...noPadding
		},
		apple: {
			...minimal2023Preset.apple,
			...noPadding
		}
	},
	images: ['static/favicon.svg']
});
