import type { FastifyRequest } from 'fastify';

/** Application-owned mapping for deliberate HTTP failures, never arbitrary provider errors. */
export interface HttpErrorResponse {
	/** HTTP failure status between 400 and 599. */
	statusCode: number;
	/** Public client-error copy. Production 5xx bodies are always replaced. */
	body: { error: string; message: string };
}

/** Server-only diagnostics passed to an application's support-record store. */
export interface HttpServerErrorContext {
	/** Request whose logger and ID correlate the failure. */
	request: FastifyRequest;
	/** Actual HTTP response status. */
	statusCode: number;
	/** Framework-generated reference shared by logs and the public response. */
	reference: string;
	/** Explicitly returned error body, if no exception reached the handler. Never public in production. */
	responseBody?: string;
}

/** Application integration points for the framework's HTTP error boundary. */
export interface HttpErrorHandlerOptions {
	/** Map only known application errors; returning undefined uses framework classification. */
	mapError?: (error: unknown) => HttpErrorResponse | undefined;
	/** Retain extra support records after framework logging. Failures here cannot leak diagnostics. */
	onServerError?: (error: unknown, context: HttpServerErrorContext) => void;
}
