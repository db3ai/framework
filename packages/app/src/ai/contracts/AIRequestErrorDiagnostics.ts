/**
 * Provider response identifiers retained on a direct AI request failure.
 *
 * These fields exclude response bodies, credentials and customer inputs. Missing
 * fields stay unknown rather than inferring an HTTP status from an error message.
 */
export interface AIRequestErrorDiagnostics {
	/** HTTP response status, when a provider response was received. */
	status?: number | null;
	/** Provider request identifier from response headers, for support correlation. */
	requestId?: string | null;
}
