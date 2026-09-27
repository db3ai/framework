import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isInteractiveDevelopmentEnvironment } from '../devtools';
import { captureBody, headerValue, redactHeaders } from './httpBodyCapture';
import type * as logging from './contracts';

/**
 * Captures bounded, redacted payloads for grouped console logs and devtools.
 * Register before routes on a Fastify host using app.log.logger. Fastify's own
 * arrival/completion records provide lifecycle timing; streams are never consumed.
 * @param server - Caller-owned HTTP server.
 * @param options - Development capture and private-route exclusion policy.
 */
export function registerHttpExchangeMonitor(server: FastifyInstance, options: logging.HttpExchangeMonitorOptions = {}): void {
	if (options.enabled === false || !isInteractiveDevelopmentEnvironment(options.environment ?? process.env.NODE_ENV)) return;
	const configured = options.maxBodyBytes;
	const maxBodyBytes = configured && Number.isFinite(configured) && configured > 0 ? Math.min(65536, Math.floor(configured)) : 16384;
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
				request: { method: request.method, url: request.url, headers: redactHeaders(request.headers), body: captureBody(request.body, headerValue(request.headers['content-type']), maxBodyBytes) },
				response: { statusCode: reply.statusCode, headers: redactHeaders(reply.getHeaders()), body: captureBody(payload, headerValue(reply.getHeader('content-type')), maxBodyBytes) },
			};
			request.log.info({ httpExchange }, 'request exchange');
		}
		done(null, payload);
	});
}
