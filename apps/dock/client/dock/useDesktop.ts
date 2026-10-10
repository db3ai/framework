import { onMounted, ref } from 'vue';

import { dockApi } from '../api.js';

/**
 * @param userAgent - Browser user agent.
 * @returns Whether the page is running inside Dock's Electron shell.
 */
export function isDesktopShell(userAgent: string): boolean {
	return /\bElectron\//.test(userAgent);
}

/**
 * Offers the Electron desktop app from the web UI: whether it is installed,
 * its install command, and an action that asks the Dock server to launch it.
 * Hidden inside the desktop app itself.
 */
export function useDesktop() {
	const inDesktop = isDesktopShell(globalThis.navigator?.userAgent ?? '');
	const installed = ref(false);
	const installCommand = ref('');
	const opening = ref(false);
	const message = ref<string | null>(null);

	/** Re-reads whether the desktop app is installed. */
	async function refresh(): Promise<void> {
		if (inDesktop) return;
		try {
			const status = await dockApi.desktop();
			installed.value = status.installed;
			installCommand.value = status.installCommand;
		} catch {
			// Older server without the endpoint: offer nothing.
		}
	}

	onMounted(refresh);

	/** Asks the server to build and launch the desktop app. */
	async function open(): Promise<void> {
		if (opening.value) return;
		opening.value = true;
		message.value = null;
		try {
			await dockApi.openDesktop();
			message.value = 'Opening the desktop app…';
			setTimeout(() => {
				message.value = null;
			}, 6000);
		} catch (error) {
			message.value = (error as Error).message;
		} finally {
			opening.value = false;
		}
	}

	return { available: !inDesktop, installed, installCommand, opening, message, open, refresh };
}
