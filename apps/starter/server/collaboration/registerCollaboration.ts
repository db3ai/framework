import type { App } from '@db3.ai/app';
import { UserIdentity } from '@db3.ai/app/auth';
import { defineWebSocket } from '@db3.ai/app/websocket';
import { registerWebSockets } from '@db3.ai/app/websocket/fastify';
import type { FastifyInstance } from 'fastify';
import type { StarterConfig } from '../config';
import { requireUser, sessionCookie } from '../http/session';
import { HttpError } from '../http/errors';
import { RoomAccess } from '../models/RoomAccess';
import { RoomController } from './RoomController';

/** Composes public rooms, session-authenticated rooms, explicit grants and a private inbox channel. */
export function registerCollaboration(server: FastifyInstance, application: App, config: StarterConfig) {
	registerWebSockets(server, {
		app: application, origins: [config.origin],
		resolveToken: request => server.parseCookie(request.headers.cookie ?? '')[sessionCookie] ?? null,
		endpoints: {
			'/ws/rooms/lobby': new RoomController(application, 'lobby').endpoint(),
			'/ws/rooms/members': new RoomController(application, 'members').endpoint(),
			'/ws/rooms/studio': new RoomController(application, 'studio').endpoint(),
			'/ws/inbox': defineWebSocket({
				/** Membership comes from the authenticated account, never a client channel name. */
				async open(context) {
					application.webSockets.channels.join(`inbox:${context.userId}`, context);
					await context.send({ type: 'inbox.changed' });
				},
			}),
		},
	});
	server.post<{ Body: { code: string } }>('/api/rooms/studio/join', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: { type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', maxLength: 128 } } } } }, async request => {
		const user = await requireUser(application, request);
		if (request.body.code !== (process.env.DEMO_ROOM_CODE ?? 'draw-together')) throw new HttpError(403, 'Incorrect room code.');
		await application.db.transaction(async () => {
			await UserIdentity.where('id', user.id).toKnex().forUpdate().first();
			const key = `studio:${user.id}`;
			if (!await RoomAccess.where('key', key).first()) await RoomAccess.create({ key }).save();
		});
		return { ok: true };
	});
}
