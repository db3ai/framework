/**
 * @param url - Navigation target.
 * @param appUrl - The Dock server origin.
 * @returns Whether the URL belongs to the Dock UI itself.
 */
export function isDockNavigation(url: string, appUrl: string): boolean {
	try {
		return new URL(url).origin === new URL(appUrl).origin;
	} catch {
		return false;
	}
}

/**
 * Links that may open in the system browser: ordinary http(s) pages, including
 * the localhost ports of supervised dev servers.
 *
 * @param url - Requested link.
 * @returns The normalised URL, or null when it must not be opened.
 */
export function externalUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
	} catch {
		return null;
	}
}

/**
 * @param url - Candidate UI address.
 * @returns Whether it is an http(s) URL on this machine.
 */
export function isLoopbackHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
			&& (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.hostname.endsWith('.localhost'));
	} catch {
		return false;
	}
}
