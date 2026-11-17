/** What a person recognises a signed-in device by. */
export interface UserAgentDescription {
	browser: string | null;
	operatingSystem: string | null;
	device: string | null;
}

/** Ordered: the first match wins, so browsers built on Chrome come before Chrome. */
const BROWSERS: Array<[RegExp, string]> = [
	[/Edg(?:e|A|iOS)?\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/Firefox\/|FxiOS\//, 'Firefox'],
	[/CriOS\/|Chrome\//, 'Chrome'], [/Safari\//, 'Safari'],
];
const SYSTEMS: Array<[RegExp, string]> = [
	[/iPhone|iPad|iPod/, 'iOS'], [/Android/, 'Android'], [/Mac OS X|Macintosh/, 'macOS'],
	[/Windows/, 'Windows'], [/CrOS/, 'ChromeOS'], [/Linux/, 'Linux'],
];

/**
 * Names the browser, operating system and kind of device in a user-agent string, so a list of
 * signed-in sessions reads "Safari on iPhone". Unknown parts are null; nothing is guessed.
 *
 * @param userAgent - The request's User-Agent header.
 * @returns The parts it recognised.
 */
export function describeUserAgent(userAgent: string | null | undefined): UserAgentDescription {
	if (!userAgent) return { browser: null, operatingSystem: null, device: null };
	const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
	const operatingSystem = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
	const device = /iPhone/.test(userAgent) ? 'iPhone'
		: /iPad/.test(userAgent) ? 'iPad'
		: /Android/.test(userAgent) ? (/Mobile/.test(userAgent) ? 'Phone' : 'Tablet')
		: operatingSystem ? 'Computer' : null;
	return { browser, operatingSystem, device };
}

/**
 * Names a session the way an account's device list shows it: "Chrome (macOS)", "db3 CLI (Linux)",
 * or "Unknown device". A session's own name, when the client gave one, wins over the browser.
 *
 * @param session - The session's name and parsed user-agent parts.
 * @returns A short label.
 */
export function sessionLabel(session: { name?: string | null } & UserAgentDescription): string {
	const what = session.name || session.browser;
	const where = session.operatingSystem ?? session.device;
	if (what && where) return `${what} (${where})`;
	return what || where || 'Unknown device';
}

/**
 * Where a request came from, as "Bristol, England, GB", from the visitor-location headers
 * Cloudflare adds (cf-ipcity, cf-region, cf-ipcountry). Null when none are present, such as
 * locally or behind a proxy that does not add them. No lookup service is called.
 *
 * @param headers - The request's headers.
 * @returns The place, or null.
 */
export function requestLocation(headers: Record<string, string | string[] | undefined>): string | null {
	const header = (name: string) => {
		const value = headers[name];
		if (typeof value !== 'string' || !value || value === 'XX' || value === 'T1') return null;
		try { return decodeURIComponent(value); } catch { return value; }
	};
	return [header('cf-ipcity'), header('cf-region'), header('cf-ipcountry')].filter(Boolean).join(', ') || null;
}
