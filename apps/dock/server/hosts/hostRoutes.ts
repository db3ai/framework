import type { FastifyInstance } from 'fastify';

import type { AddHostRequest, ContainerAction } from '../../shared/hostContracts.js';
import { DockRequestError } from '../projects/ProjectStore.js';
import type { HostMonitor } from './HostMonitor.js';

const ACTIONS = new Set<ContainerAction>(['start', 'stop', 'restart']);

/**
 * Registers the server (Docker host) API. The event stream for host snapshots is
 * shared with the process events at `/api/events`; see `createServer`.
 *
 * @param server - Fastify server; its loopback checks apply here too.
 * @param hosts - Opened host monitor.
 */
export function registerHostRoutes(server: FastifyInstance, hosts: HostMonitor): void {
	server.get('/api/hosts', async () => ({ hosts: hosts.state() }));

	server.post<{ Body: AddHostRequest }>('/api/hosts', async request => {
		return hosts.addHost({ name: String(request.body?.name ?? ''), ssh: request.body?.ssh ? String(request.body.ssh) : undefined });
	});

	server.delete<{ Params: { id: string } }>('/api/hosts/:id', async request => {
		await hosts.removeHost(request.params.id);
		return { ok: true };
	});

	server.post<{ Params: { id: string } }>('/api/hosts/:id/refresh', async request => {
		await hosts.refresh(request.params.id);
		return { ok: true };
	});

	server.post<{ Params: { id: string; name: string; action: string } }>('/api/hosts/:id/containers/:name/:action', async request => {
		const { id, name, action } = request.params;
		if (!ACTIONS.has(action as ContainerAction)) throw new DockRequestError(`Unknown action "${action}".`, 404);
		await hosts.action(id, name, action as ContainerAction);
		return { ok: true };
	});

	// One log stream per open pane: server-sent `{ seq, data }` chunks, then `{ end }`.
	server.get<{ Params: { id: string; name: string }; Querystring: { tail?: string } }>('/api/hosts/:id/containers/:name/logs', (request, reply) => {
		const tail = Number(request.query.tail ?? 500) || 500;
		let seq = 0;
		let stop: (() => void) | null = null;
		const send = (payload: unknown) => {
			if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
		};
		try {
			stop = hosts.logs(request.params.id, request.params.name, data => send({ seq: ++seq, data }), message => {
				send({ end: message });
				if (!reply.raw.writableEnded) reply.raw.end();
			}, tail);
		} catch (error) {
			const status = error instanceof DockRequestError ? error.statusCode : 500;
			return reply.code(status).send({ error: (error as Error).message });
		}
		reply.raw.writeHead(200, {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive',
		});
		const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15000);
		request.raw.on('close', () => {
			clearInterval(heartbeat);
			stop?.();
		});
	});
}
