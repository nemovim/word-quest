import { get, writable } from 'svelte/store';

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const pwaInstallPrompt = writable<BeforeInstallPromptEvent | null>(null);

export function listenForPwaInstall(): () => void {
	function savePrompt(event: Event): void {
		event.preventDefault();
		pwaInstallPrompt.set(event as BeforeInstallPromptEvent);
	}

	function clearPrompt(): void {
		pwaInstallPrompt.set(null);
	}

	window.addEventListener('beforeinstallprompt', savePrompt);
	window.addEventListener('appinstalled', clearPrompt);

	return () => {
		window.removeEventListener('beforeinstallprompt', savePrompt);
		window.removeEventListener('appinstalled', clearPrompt);
	};
}

export async function requestPwaInstall(): Promise<void> {
	const prompt = get(pwaInstallPrompt);

	if (prompt == null) {
		return;
	}

	await prompt.prompt();
	await prompt.userChoice;
	pwaInstallPrompt.set(null);
}
