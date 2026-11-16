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
