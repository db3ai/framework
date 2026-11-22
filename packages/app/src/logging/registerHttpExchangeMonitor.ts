import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isInteractiveDevelopmentEnvironment } from '../devtools';
import { captureBody, headerValue, redactHeaders } from './httpBodyCapture';
import type * as logging from './contracts';

/** Requests whose route marks its input secret; see {@link hideRequestBody}. */
const hiddenBodies = new WeakSet<FastifyRequest>();

/**
 * Keeps one request's body out of every log record, for input such as a secret's value that no
 * field name gives away. App routes call it for a route with `secretInput`.
 * @param request - The request whose body must never be logged.
 */
export function hideRequestBody(request: FastifyRequest): void {
	hiddenBodies.add(request);
}

/**
 * Captures bounded, redacted payloads for grouped console logs and devtools.
 * Register before routes on a Fastify host using app.log.logger. Fastify's own
 * arrival/completion records provide lifecycle timing; streams are never consumed.
 * Outside development it logs only request bodies with their masked headers, and only with `requestBodies`.
 * @param server - Caller-owned HTTP server.
 * @param options - Capture and private-route exclusion policy.
 */
export function registerHttpExchangeMonitor(server: FastifyInstance, options: logging.HttpExchangeMonitorOptions = {}): void {
	const environment = (options.environment ?? process.env.NODE_ENV ?? '').toLowerCase().trim();
	if (options.enabled === false || environment === 'test') return;
	const configured = options.maxBodyBytes;
	const maxBodyBytes = configured && Number.isFinite(configured) && configured > 0 ? Math.min(65536, Math.floor(configured)) : 16384;
	/** The request body as logged: hidden when its route marks the input secret. */
	const requestBody = (request: FastifyRequest): logging.HttpBodyLog => hiddenBodies.has(request)
		? { kind: 'hidden', note: 'This route marks its input secret.' }
		: captureBody(request.body, headerValue(request.headers['content-type']), maxBodyBytes);
	if (!isInteractiveDevelopmentEnvironment(environment)) {
		if (!options.requestBodies) return;
		server.addHook('onSend', (request, _reply, payload, done) => {
			if (request.body !== undefined && request.body !== null && request.body !== '' && !options.exclude?.(request)) {
				request.log.info({ requestHeaders: redactHeaders(request.headers), requestBody: requestBody(request) }, 'request body');
			}
			done(null, payload);
		});
		return;
	}
	const ended = new WeakSet<FastifyRequest>();

	/** Reports one terminal interruption even if timeout and socket close both fire. */
	function interrupted(request: FastifyRequest, message: string): void {
		if (ended.has(request)) return;
		ended.add(request);
		request.log.warn(message);
	}

	server.addHook('onRequest', (request, reply, done) => {
		reply.raw.once('close', () => {
			if (!reply.raw.writableFinished) interrupted(request, 'request aborted');
		});
		done();
	});
	server.addHook('onTimeout', (request, _reply, done) => { interrupted(request, 'request timed out'); done(); });
	server.addHook('onRequestAbort', (request, done) => { interrupted(request, 'request aborted'); done(); });
	server.addHook('onResponse', (request, _reply, done) => { ended.add(request); done(); });
	server.addHook('onSend', (request, reply, payload, done) => {
		if (!options.exclude?.(request)) {
			const httpExchange: logging.HttpExchangeLog = {
				request: { method: request.method, url: request.url, headers: redactHeaders(request.headers), body: requestBody(request) },
				response: { statusCode: reply.statusCode, headers: redactHeaders(reply.getHeaders()), body: captureBody(payload, headerValue(reply.getHeader('content-type')), maxBodyBytes) },
			};
			request.log.info({ httpExchange }, 'request exchange');
		}
		done(null, payload);
	});
}
