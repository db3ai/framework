import type * as url from './contracts';

/**
 * Canonical application URL generator.
 *
 * The generator is intentionally independent of a concrete server adapter and
 * the current request. API, queue, scheduler, console, and future SSR runtimes
 * can therefore share one trusted application origin. Request-specific SSR
 * state belongs to the request context and must not replace this canonical URL.
 *
 * @example
 * const callback = app().url.to('/api/integrations/provider/callback');
 */
export class UrlGenerator {
	/** Normalized browser-facing application URL without a trailing slash. */
	readonly baseUrl: string;

	/**
	 * Creates the canonical application URL generator.
	 *
	 * @param options - Public deployment URL or local browser port configuration.
	 */
	constructor(options: url.UrlGeneratorOptions = {}) {
		this.baseUrl = resolveBaseUrl(options);
	}

	/**
	 * Builds an absolute application URL from a path or relative reference.
	 *
	 * @param path - Application path or relative URL to resolve.
	 * @returns Absolute browser-facing application URL.
	 *
	 * @example
	 * app().url.to('/auth/reset-password');
	 */
	to(path: string): string {
		return new URL(path, `${this.baseUrl}/`).toString();
	}
}

/**
 * Resolves and validates the one canonical application base URL.
 *
 * @param options - Explicit public URL or local browser port configuration.
 * @returns Normalized HTTP(S) application base URL without a trailing slash.
 */
function resolveBaseUrl(options: url.UrlGeneratorOptions): string {
	const configured = options.baseUrl
		|| process.env.APP_URL
		|| process.env.PUBLIC_APP_URL;

	if (configured) {
		const normalized = configured.trim().replace(/\/+$/, '');
		const parsed = new URL(normalized);

		if (!['http:', 'https:'].includes(parsed.protocol)) {
			throw new Error('Application base URL must use http or https.');
		}

		return normalized;
	}

	if (options.localPort !== undefined) {
		if (!Number.isInteger(options.localPort) || options.localPort < 1 || options.localPort > 65_535) {
			throw new Error('Application local port must be an integer between 1 and 65535.');
		}

		return `http://localhost:${options.localPort}`;
	}

	throw new Error('Application base URL is not configured. Set APP_URL or provide a local port.');
}
