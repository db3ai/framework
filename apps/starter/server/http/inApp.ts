import type { FastifyInstance } from 'fastify';
import type { App } from '@db3.ai/app';
import type { InAppTransition } from '@db3.ai/app/in-app/contracts';
import { requireUser } from './session';

/** Registers the authenticated account inbox and a fixed, self-addressed demo producer. */
export function registerInAppRoutes(server: FastifyInstance, application: App) {
	const scope = { type: 'account' } as const;
	server.get<{ Querystring: { before?: string; view?: 'inbox' | 'banners' } }>('/api/inbox', { schema: { querystring: { type: 'object', additionalProperties: false, properties: { before: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' }, view: { enum: ['inbox', 'banners'] } } } } }, async request => {
		await requireUser(application, request);
		return application.inApp.inbox({ scope, limit: 25, ...request.query });
	});
	server.post<{ Params: { id: string }; Body: { transition: InAppTransition } }>('/api/inbox/:id', { schema: {
		params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' } } },
		body: { type: 'object', additionalProperties: false, required: ['transition'], properties: { transition: { enum: ['read', 'unread', 'dismiss', 'archive'] } } },
	} }, async request => {
		const user = await requireUser(application, request);
		await application.inApp.update(request.params.id, request.body.transition, scope);
		await application.webSockets.channels.publish(`inbox:${user.id}`, { type: 'inbox.changed' });
		return { ok: true };
	});
	server.post<{ Body: { presentation: 'inbox' | 'toast' | 'banner' } }>('/api/inbox/demo', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { body: { type: 'object', additionalProperties: false, required: ['presentation'], properties: { presentation: { enum: ['inbox', 'toast', 'banner'] } } } } }, async (request, reply) => {
		const user = await requireUser(application, request);
		const [receipt] = await application.inApp.send(String(user.id), {
			title: 'Your report is ready', body: 'Your demo report has finished. This message is saved in your inbox.',
			presentation: request.body.presentation, severity: 'success', action: { label: 'View notebook', href: '/#notebook' },
		}, { scope, type: 'demo.report-ready' });
		await application.webSockets.channels.publish(`inbox:${user.id}`, { type: 'inbox.changed' });
		return reply.code(201).send(receipt);
	});
}
