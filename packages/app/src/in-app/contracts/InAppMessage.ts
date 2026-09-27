/** Recipient-facing content stored in an inbox. */
export interface InAppMessage {
	title: string;
	/** Plain-text fallback used by compact, accessibility and non-HTML renderers. */
	body: string;
	/**
	 * Optional rich body authored by trusted application code.
	 *
	 * The framework validates and stores this value but does not sanitize it because
	 * permitted markup is an application policy. Every HTML renderer must sanitize it.
	 */
	bodyHtml?: string;
	/** Defaults to info. Severity does not determine persistence or prominence. */
	severity?: 'info' | 'success' | 'warning' | 'error';
	/** Defaults to toast. Every presentation remains in the durable inbox. */
	presentation?: 'inbox' | 'toast' | 'banner';
	/** Root-relative or HTTP(S) action; the destination must enforce its own authorization. */
	action?: { label: string; href: string };
}
