/**
 * Validates the sole application origin before creating any desktop windows.
 * Plain HTTP is permitted only for explicitly enabled loopback development.
 */
export function resolveAppUrl(value: string, allowLocalHttp: boolean): string {
	const url = new URL(value);
	const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (url.username || url.password || (url.protocol !== 'https:' && !(allowLocalHttp && loopback && url.protocol === 'http:'))) {
		throw new Error('The app URL must use HTTPS, or explicitly enabled loopback HTTP. Credentials in URLs are forbidden.');
	}
	return url.href;
}

/** Determines whether a destination stays inside the configured application origin. */
export function isAppNavigation(destination: string, appUrl: string): boolean {
	try {
		const url = new URL(destination);
		return !url.username && !url.password && url.origin === new URL(appUrl).origin;
	} catch {
		return false;
	}
}

/** Allows ordinary web links in the system browser, never local files or custom protocols. */
export function externalWebUrl(destination: string): string | null {
	try {
		const url = new URL(destination);
		return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
	} catch {
		return null;
	}
}
