/**
 * Raised when an outbound request targets a URL the network guard refuses.
 *
 * The message is safe to show to the user who supplied the URL: it names the
 * rule that failed without revealing resolved internal addresses. Callers
 * typically catch it to turn a blocked crawl, webhook or preview into a
 * validation error instead of a server failure.
 */
export class BlockedUrlError extends Error {
	/**
	 * Creates a blocked-URL error with a public explanation.
	 *
	 * @param message - Caller-safe reason the URL was refused.
	 */
	constructor(message = 'This URL is not allowed.') {
		super(message);
		this.name = 'BlockedUrlError';
	}
}
