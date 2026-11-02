import type { FastifyInstance, FastifyReply } from 'fastify';
import { FlowTriggerError, type FlowFormResponse, type FlowTriggers } from './FlowTriggers';

/** Where the app serves flow triggers. */
export const FLOW_TRIGGER_PREFIX = '/_db3/flows';

/**
 * Serves webhook and hosted form triggers for the app's flows:
 *
 * - `POST <prefix>/:flow/:trigger` takes a webhook delivery (JSON) and answers 202 with the run id.
 * - `GET <prefix>/:flow/:trigger/form` shows the hosted form; `POST` the same address sends it.
 *
 * @param server - The app's Fastify server.
 * @param triggers - The app's flow triggers, such as `() => app().flows.triggers`.
 * @param prefix - Path the routes live under.
 *
 * @example
 * await registerFlowTriggerRoutes(server, () => app().flows.triggers);
 */
export async function registerFlowTriggerRoutes(server: FastifyInstance, triggers: () => FlowTriggers, prefix = FLOW_TRIGGER_PREFIX): Promise<void> {
	await server.register(async scope => {
		scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_request, body, done) => {
			done(null, Object.fromEntries(new URLSearchParams(String(body))));
		});

		scope.setErrorHandler((error, _request, reply) => {
			if (error instanceof FlowTriggerError) return reply.status(error.status).send({ error: error.message });
			const status = (error as { statusCode?: number }).statusCode;
			if (status && status < 500) return reply.status(status).send({ error: error instanceof Error ? error.message : 'Bad request.' });
			scope.log.error(error);
			return reply.status(500).send({ error: 'The flow could not be started.' });
		});

		scope.post<{ Params: { flow: string; trigger: string } }>('/:flow/:trigger', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
			const idempotencyKey = request.headers['idempotency-key'];
			const result = await triggers().webhook(request.params.flow, request.params.trigger, {
				authorization: request.headers.authorization,
				idempotencyKey: Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey,
				body: request.body,
			});
			return reply.status(202).send({ runId: result.runId, status: 'accepted', duplicate: result.duplicate });
		});

		scope.get<{ Params: { flow: string; trigger: string } }>('/:flow/:trigger/form', async (request, reply) => {
			return send(reply, await triggers().formPage(request.params.flow, request.params.trigger, request.url.split('?')[0]));
		});

		scope.post<{ Params: { flow: string; trigger: string }; Body: Record<string, string> }>('/:flow/:trigger/form', async (request, reply) => {
			const fields = request.body && typeof request.body === 'object' ? Object.fromEntries(Object.entries(request.body).map(([key, value]) => [key, String(value)])) : {};
			return send(reply, await triggers().submitForm(request.params.flow, request.params.trigger, fields, request.ip, request.url.split('?')[0]));
		});
	}, { prefix });
}

function send(reply: FastifyReply, page: FlowFormResponse): FastifyReply {
	return reply.status(page.status).headers(page.headers).send(page.html);
}
