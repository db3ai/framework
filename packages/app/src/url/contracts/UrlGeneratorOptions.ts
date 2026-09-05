/**
 * Canonical application URL configuration.
 *
 * The explicit public URL is authoritative in deployed environments. A local
 * port can provide a browser-facing development origin without duplicating a
 * complete application URL alongside the frontend server configuration.
 */
export interface UrlGeneratorOptions {
	/** Public application base URL, such as `https://example.com`. */
	baseUrl?: string;

	/** Browser-facing localhost port used when no public base URL is configured. */
	localPort?: number;
}
