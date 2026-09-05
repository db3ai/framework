import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { MediaFile } from '@db3.ai/app/media';
import type { App } from '@db3.ai/app/server';

/**
 * Builds a deliberately small private-text-file API without opening a socket.
 *
 * The caller owns App and server cleanup. Uploads are bounded to 64 KiB and
 * buffered by the HTTP parser; downloads stream only after owner authorization.
 * Bearer tokens are lab inputs. A deployed endpoint requires HTTPS and an
 * application-owned token issuance and storage policy.
 *
 * @param application - Active application with Auth, Media and local storage.
 * @returns Injectable HTTP server exposing POST, GET and DELETE /files.
 */
export function createPrivateFileServer(application: App): FastifyInstance {
	const server = Fastify({ bodyLimit: 64 * 1024 });
	server.addHook('onRequest', (_request, _reply, done) => application.requestContext.run(done));

	/** Resolves a bearer token without accepting a caller-supplied owner id. */
	async function owner(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
		const authorization = request.headers.authorization;
		const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
		const user = token ? await application.auth.authenticateToken(token) : null;
		if (!user?.id) { reply.code(401).send({ error: 'Sign in first.' }); return null; }
		return user.id;
	}

	server.post<{ Body: string }>('/files', async (request, reply) => {
		const ownerId = await owner(request, reply);
		if (!ownerId) return;
		if (request.headers['content-type']?.split(';')[0]?.trim() !== 'text/plain' || typeof request.body !== 'string' || !request.body.trim()) return reply.code(400).send({ error: 'Supply non-empty text/plain.' });
		const library = await application.media.libraryFor({ scopeType: 'user', scopeId: ownerId, pathPrefix: `users/${ownerId}` });
		const file = await application.media.storeFile({ library, name: 'brief.txt', mimeType: 'text/plain', contents: request.body, visibility: 'private', source: 'upload' });
		return reply.code(201).send({ id: file.id, name: file.name, size: file.size });
	});
	server.get<{ Params: { id: string } }>('/files/:id', async (request, reply) => {
		const ownerId = await owner(request, reply);
		if (!ownerId) return;
		const library = await application.media.libraryFor({ scopeType: 'user', scopeId: ownerId });
		const file = await MediaFile.where({ id: request.params.id, library }).first();
		if (!file) return reply.code(404).send({ error: 'File not found.' });
		return reply.header('Cache-Control', 'private, no-store').header('Content-Type', 'text/plain; charset=utf-8').header('Content-Disposition', 'attachment; filename="brief.txt"').header('X-Content-Type-Options', 'nosniff').send(await application.media.readFileStream(file));
	});
	server.delete<{ Params: { id: string } }>('/files/:id', async (request, reply) => {
		const ownerId = await owner(request, reply);
		if (!ownerId) return;
		const library = await application.media.libraryFor({ scopeType: 'user', scopeId: ownerId });
		const file = await MediaFile.where({ id: request.params.id, library }).first();
		if (!file) return reply.code(404).send({ error: 'File not found.' });
		await application.media.deleteFile(file);
		return reply.code(204).send();
	});
	return server;
}
