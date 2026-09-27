import Fastify, { type FastifyBaseLogger } from 'fastify';
import { registerHttpExchangeMonitor } from '@db3.ai/app/logging';
import { InAppError } from '@db3.ai/app/in-app';
import { databaseHealthCheck } from '@db3.ai/app/health';
import { registerHealthRoute } from '@db3.ai/app/health/fastify';
import { registerInAppRoutes } from './inApp';
import { registerCollaboration } from '../collaboration/registerCollaboration';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { App } from '@db3.ai/app';
import { AppRouteError } from '@db3.ai/app/apps';
import type { AppAction } from '@db3.ai/app/apps/contracts';
import { registerAppRoutes } from '@db3.ai/app/apps/fastify';
import { AuthIdentityExistsError, PasswordSuspendedError } from '@db3.ai/app/auth';
import { AIRequestError, AIRateLimitDeferredError, AIConfigurationError, AIUsagePersistenceError } from '@db3.ai/app/ai';
import type { StarterConfig } from '../config';
import { Note } from '../models/Note';
import { AiAllowance } from '../ai/AiAllowance';
import { summariseNote } from '../ai/summariseNote';
import { requireUser, sessionCookie, setSession } from './session';
import { HttpError } from './errors';

const email = { type: 'string', format: 'email', maxLength: 255 };
const password = { type: 'string', minLength: 12, maxLength: 128 };
const credentials = { type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email, password } };
const noteBody = { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' }, body: { type: 'string', minLength: 1, maxLength: 20_000, pattern: '\\S' } } };
const noteParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' } } };
const notePatch = { ...noteBody, required: [], minProperties: 1 };

/**
 * Composes real Auth/ActiveRecord routes and the optional server-only AI client.
 * External HTTP may be replaced in tests; framework services are never mocked.
 */
export async function createServer(application: App, config: StarterConfig) {
	await application.apps.boot();
	const server = Fastify({ loggerInstance: application.log.logger as FastifyBaseLogger, bodyLimit: 96 * 1024, ajv: { customOptions: { removeAdditional: false } } });
	registerHttpExchangeMonitor(server);
	const ai = config.ai.apiKey ? application.ai : null;
	const allowance = new AiAllowance();
	application.health.register('database', databaseHealthCheck(application.db));
	registerHealthRoute(server, { app: application });
	await server.register(cookie);
	await server.register(rateLimit, { max: 120, timeWindow: '1 minute', cache: 10_000 });
	server.addHook('onRequest', (request, reply, done) => {
		reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'same-origin');
		// Strict Origin verification covers login CSRF as well as authenticated writes.
		if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== config.origin) {
			reply.code(403).send({ message: 'Request origin is not allowed.' });
			return;
		}
		application.requestContext.run(done);
	});
	server.setErrorHandler((error, _request, reply) => {
		if (error instanceof PasswordSuspendedError) return reply.code(429).send({ error: 'too_many_attempts', message: error.message });
		if (error instanceof InAppError) return reply.code({ invalid: 400, unauthenticated: 401, forbidden: 403, not_found: 404, conflict: 409 }[error.code]).send({ message: error.message });
		if (error instanceof HttpError || error instanceof AppRouteError) return reply.code(error.statusCode).send({ message: error.message });
		if (error instanceof AuthIdentityExistsError) return reply.code(409).send({ message: 'An account with that email already exists. Try signing in.' });
		if (error instanceof AIRequestError || error instanceof AIRateLimitDeferredError || error instanceof AIConfigurationError || error instanceof AIUsagePersistenceError) return reply.code(error instanceof AIRateLimitDeferredError ? 429 : 502).send({ message: 'AI could not complete this request. Check the server API key, model and provider limits before trying again.', code: error instanceof AIRateLimitDeferredError ? 'rate_limit' : 'ai_failed' });
		if (error && typeof error === 'object' && 'validation' in error) return reply.code(400).send({ message: 'Check the supplied fields and their length limits.' });
		if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 429) return reply.code(429).send({ message: 'Too many requests. Try again shortly.' });
		// Do not serialize SQL errors, request bodies, credentials or provider payloads.
		return reply.code(500).send({ message: 'The request could not be completed.' });
	});
	server.get('/api/config', async () => ({ name: config.name, aiEnabled: Boolean(ai), googleClientId: config.auth.googleClientId }));
	server.get('/api/me', async request => {
		const token = request.cookies[sessionCookie];
		const user = token ? await application.auth.authenticateToken(token) : null;
		return { user: user ? { id: user.id, name: user.name, email: user.email } : null };
	});
	server.post<{ Body: { name: string; email: string; password: string } }>('/api/register', {
		config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
		schema: { body: { ...credentials, required: ['name', 'email', 'password'], properties: { ...credentials.properties, name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' } } } },
	}, async (request, reply) => {
		const input = { ...request.body, name: request.body.name.trim(), email: request.body.email.trim().toLowerCase() };
		const issued = await application.auth.registerWithPassword(input, { expiresInMs: 7 * 24 * 60 * 60 * 1000 });
		setSession(reply, issued.token, config.production);
		return reply.code(201).send({ ok: true });
	});
	server.post<{ Body: { email: string; password: string } }>('/api/login', {
		config: { rateLimit: { max: 10, timeWindow: '15 minutes' } }, schema: { body: credentials },
	}, async (request, reply) => {
		const issued = await application.auth.issueTokenForProvider('password', { ...request.body, email: request.body.email.trim().toLowerCase() }, { expiresInMs: 7 * 24 * 60 * 60 * 1000 });
		if (!issued) throw new HttpError(401, 'Email or password is incorrect.');
		setSession(reply, issued.token, config.production);
		return { ok: true };
	});
	server.post('/api/logout', async (request, reply) => {
		await requireUser(application, request);
		await application.auth.revokeCurrentToken();
		reply.clearCookie(sessionCookie, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.production });
		return { ok: true };
	});
	server.get('/api/notes', async request => {
		const user = await requireUser(application, request);
		return { notes: (await Note.where('owner', user.id).orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(100).all()).map(note => note.toJSON()) };
	});
	server.post<{ Body: { title: string; body: string } }>('/api/notes', { schema: { body: noteBody } }, async (request, reply) => {
		const user = await requireUser(application, request);
		const note = new Note();
		note.setFromRequest(request.body);
		note.assign({ owner: user.id });
		await note.save();
		return reply.code(201).send({ note: note.toJSON() });
	});
	server.get<{ Params: { id: string } }>('/api/notes/:id', { schema: { params: noteParams } }, async request => {
		const user = await requireUser(application, request);
		const note = await Note.where({ id: request.params.id, owner: user.id }).first();
		if (!note) throw new HttpError(404, 'Note not found.');
		return { note: note.toJSON() };
	});
	server.patch<{ Params: { id: string }; Body: { title?: string; body?: string } }>('/api/notes/:id', { schema: { params: noteParams, body: notePatch } }, async request => {
		const user = await requireUser(application, request);
		const note = await Note.where({ id: request.params.id, owner: user.id }).first();
		if (!note) throw new HttpError(404, 'Note not found.');
		note.setFromRequest(request.body);
		await note.save();
		return { note: note.toJSON() };
	});
	server.delete<{ Params: { id: string } }>('/api/notes/:id', { schema: { params: noteParams } }, async request => {
		const user = await requireUser(application, request);
		const note = await Note.where({ id: request.params.id, owner: user.id }).first();
		if (!note) throw new HttpError(404, 'Note not found.');
		await note.delete();
		return { ok: true };
	});
	/** Keeps host-wide lifecycle actions behind the configured single-process administrator policy. */
	server.post<{ Params: { id: string } }>('/api/notes/:id/summarise', { schema: { params: noteParams } }, async request => {
		const user = await requireUser(application, request);
		return summariseNote(user.id!, request.params.id, ai, allowance);
	});
	registerInAppRoutes(server, application);
	registerCollaboration(server, application, config);
	server.get('/api/apps', async request => {
		const user = await requireUser(application, request);
		return { apps: await application.apps.describe(), canManage: Boolean(config.appsManageOnline && config.appsAdminEmail && user.email?.toLowerCase() === config.appsAdminEmail) };
	});
	/** Collects viewer-specific contributions using the authenticated session, never a client-supplied identity. */
	server.get('/api/app-navigation', async request => {
		const user = await requireUser(application, request);
		return application.apps.navigation({ actor: { id: user.id! } });
	});
	/** Keeps host-wide lifecycle actions behind the configured single-process administrator policy. */
	server.post<{ Params: { id: string; action: string } }>('/api/app-management/:id/:action', async request => {
		const user = await requireUser(application, request);
		if (!config.appsManageOnline || !config.appsAdminEmail || user.email?.toLowerCase() !== config.appsAdminEmail) throw new HttpError(403, 'App management requires the configured administrator.');
		if (!['install', 'enable', 'disable', 'uninstall'].includes(request.params.action)) throw new HttpError(400, 'Unknown app action.');
		return { apps: await application.apps.manage(request.params.action as AppAction, request.params.id) };
	});
	registerAppRoutes(server, application.apps, async request => {
		const user = await requireUser(application, request);
		return { id: user.id! };
	});
	return server;
}
