/**
 * Body representation retained by development HTTP exchange logging.
 */
export interface HttpBodyLog {
	/** How the original payload was represented or why it was omitted. */
	kind: 'empty' | 'json' | 'text' | 'binary' | 'stream';
	/** Media type reported by the request or response. */
	contentType?: string;
	/** Redacted serialized payload size before the development capture limit. */
	sizeBytes?: number;
	/** Whether the displayed value was shortened to the configured byte limit. */
	truncated?: boolean;
	/** Redacted JSON value or captured text when the body is inspectable. */
	value?: unknown;
	/** Human-readable explanation for an omitted payload. */
	note?: string;
}

/**
 * Request fields retained by a development HTTP exchange record.
 */
export interface HttpRequestLog {
	/** HTTP method used by the client. */
	method: string;
	/** Path and query string requested by the client. */
	url: string;
	/** Redacted request headers. */
	headers: Record<string, unknown>;
	/** Bounded and redacted request payload. */
	body: HttpBodyLog;
}

/**
 * Response fields retained by a development HTTP exchange record.
 */
export interface HttpResponseLog {
	/** HTTP status selected before the response is sent. */
	statusCode: number;
	/** Redacted response headers. */
	headers: Record<string, unknown>;
	/** Bounded and redacted response payload. */
	body: HttpBodyLog;
}

/**
 * Development-only request and response data attached to a Pino log record.
 */
export interface HttpExchangeLog {
	/** Incoming request details visible to the Fastify handler. */
	request: HttpRequestLog;
	/** Outgoing response details visible to Fastify's send lifecycle. */
	response: HttpResponseLog;
}
