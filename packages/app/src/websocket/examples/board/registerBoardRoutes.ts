import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { App } from '@db3.ai/app/server';
import { z } from 'zod';
import { LiveBoard } from './LiveBoard';

/** Registers the example's bearer-authenticated HTTP API beside the shared WebSocket endpoint. */
export function registerBoardRoutes(server: FastifyInstance, application: App): void {
	/** Creates a fresh authentication scope and maps expected example errors without disclosing private data. */
	function authorized(action: (id: string, userId: string, body: unknown) => Promise<unknown>) {
		return async (request: FastifyRequest, reply: FastifyReply) => application.requestContext.run(async () => {
			const header = request.headers.authorization ?? '';
			const user = header.startsWith('Bearer ') ? await application.auth.authenticateToken(header.slice(7)) : null;
			if (!user) return reply.code(401).send({ error: 'Sign in required.' });
			try {
				const { id } = z.object({ id: z.string().min(1).max(26) }).parse(request.params);
				return await action(id, String(user.id), request.body);
			} catch (error) {
				if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid board input.' });
				if (error instanceof Error && error.message === 'Board changed; reload before saving.') return reply.code(409).send({ error: error.message });
				if (error instanceof Error && ['Board unavailable.', 'Card unavailable.'].includes(error.message)) return reply.code(404).send({ error: 'Board unavailable.' });
				throw error;
			}
		});
	}
	server.get('/boards/:id', authorized((id, userId) => LiveBoard.snapshot(id, userId)));
	server.patch('/boards/:id', authorized((id, userId, body) => LiveBoard.move(id, userId, body)));
	server.post('/boards/:id/summary', authorized((id, userId, body) => {
		const { requestId } = z.object({ requestId: z.string().uuid() }).strict().parse(body);
		return LiveBoard.startSummary(id, userId, requestId);
	}));
}
