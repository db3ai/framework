import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errorCodeForStatus, isDevelopmentEnvironment, isSqlError } from '@db3.ai/pure';
import { ulid } from '@db3.ai/pure/ulid';
import { RecordNotFoundError } from '../db';
import { publicServerErrorMessage } from './publicServerErrorMessage';
import { registerBrowserJsonFormatting } from './registerBrowserJsonFormatting';
import type * as server from './contracts';

/**
 * Installs framework error logging and production-safe HTTP responses.
 *
 * Call immediately after constructing Fastify, before registering any routes or
 * plugins. The inherited send hook also sanitizes explicit 5xx responses and
 * child-plugin error handlers. Only deliberate mapped client errors and Fastify
 * request errors retain public messages. Browser JSON formatting is installed
 * after this boundary so it only sees the safe serialized response. Never send
 * internal errors as 2xx data.
 *
 * @param fastify - HTTP host, still owned and closed by the caller.
 * @param options - Application error classification and support-record observer.
 * @example
 * const server = Fastify({ logger: true });
 * registerHttpErrorHandler(server);
 * server.get('/example', async () => loadExample());
 */
export function registerHttpErrorHandler(fastify: FastifyInstance, options: server.HttpErrorHandlerOptions = {}): void {
	const failures = new WeakMap<FastifyReply, { error: unknown; reference?: string }>();

	/** Records the original exception once, keeping support-store failures private. */
	function recordFailure(request: FastifyRequest, reply: FastifyReply, error: unknown, responseBody?: string): string {
		const existing = failures.get(reply);
		if (existing?.reference) return existing.reference;
		const reference = ulid();
		failures.set(reply, { error, reference });
		const context = { request, statusCode: reply.statusCode, reference, responseBody };
		request.log.error({ err: error, requestMethod: request.method, requestUrl: request.url, statusCode: reply.statusCode, reference, responseBody }, 'Request failed with server error');
		try {
			options.onServerError?.(error, context);
		} catch (observerError) {
			request.log.error({ err: observerError, reference }, 'Server error observer failed');
		}
		return reference;
	}

	fastify.addHook('onError', (_request, reply, error, done) => {
		failures.set(reply, { error });
		done();
	});

	fastify.setErrorHandler((error, request, reply) => {
		const mapped = isSqlError(error) ? undefined : options.mapError?.(error);
		const response = mapped && Number.isInteger(mapped.statusCode) && mapped.statusCode >= 400 && mapped.statusCode <= 599
			? mapped
			: defaultErrorResponse(error);
		reply.type('application/json').code(response.statusCode);
		if (response.statusCode < 500) return reply.send(response.body);
		const reference = recordFailure(request, reply, error);
		return reply.send({ ...response.body, reference });
	});

	fastify.addHook('onSend', (request, reply, payload, done) => {
		const failure = failures.get(reply);
		if (reply.statusCode < 500) {
			if (!isSqlError(failure?.error)) return done(null, payload);
			// A child handler cannot make a database failure public by labelling
			// it a client error or a successful response.
			reply.code(500);
		}
		const responseBody = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : undefined;
		const reference = recordFailure(request, reply, failure?.error ?? new Error(`HTTP ${reply.statusCode} response`), responseBody);
		if (isDevelopmentEnvironment(process.env.NODE_ENV)) return done(null, payload);

		// Replace the serialized body too: route schemas and child handlers must
		// not reintroduce stack traces, SQL, provider codes or arbitrary metadata.
		if (payload && typeof payload === 'object' && 'destroy' in payload && typeof payload.destroy === 'function') payload.destroy();
		reply.removeHeader('content-length');
		reply.removeHeader('content-encoding');
		reply.type('application/json').header('cache-control', 'no-store');
		return done(null, JSON.stringify({ error: 'server_error', message: publicServerErrorMessage(failure?.error), reference }));
	});
	registerBrowserJsonFormatting(fastify);
}

/** Classifies framework client errors without trusting third-party status codes. */
function defaultErrorResponse(error: unknown): server.HttpErrorResponse {
	if (!isSqlError(error) && error instanceof RecordNotFoundError) {
		return { statusCode: 404, body: { error: 'not_found', message: error.message } };
	}
	if (!isSqlError(error) && error instanceof Error) {
		const { code, statusCode } = error as Error & { code?: unknown; statusCode?: unknown };
		if (typeof code === 'string' && code.startsWith('FST_') && typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
			return { statusCode, body: { error: errorCodeForStatus(statusCode), message: error.message } };
		}
	}
	return { statusCode: 500, body: { error: 'server_error', message: publicServerErrorMessage(error) } };
}
