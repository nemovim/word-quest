/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { build, files, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const cacheName = `word-quest-${version}`;
const assets = [...build, ...files];
const assetPaths = new Set(assets);
const offlinePage = '/offline.html';

worker.addEventListener('install', (event) => {
	event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)));
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter(
							(key) =>
								(key.startsWith('word-quest-') || key.startsWith('wordnote-')) &&
								key !== cacheName
						)
						.map((key) => caches.delete(key))
				)
			)
	);
});

worker.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	if (event.request.method !== 'GET' || url.origin !== worker.location.origin) {
		return;
	}

	if (event.request.mode === 'navigate') {
		event.respondWith(
			fetch(event.request).catch(async () => {
				const cache = await caches.open(cacheName);
				return (await cache.match(offlinePage)) ?? Response.error();
			})
		);
	} else if (assetPaths.has(url.pathname)) {
		event.respondWith(
			caches
				.open(cacheName)
				.then(async (cache) => (await cache.match(event.request)) ?? fetch(event.request))
		);
	}
});
