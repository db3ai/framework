import type { FastifyInstance, FastifyReply } from 'fastify';

import type { ProcessSnapshot } from '../../shared/contracts.js';
import type { Dock } from '../Dock.js';
import type { ConsoleKeys } from './ConsoleKeys.js';

/** Where a db3 app answers the console API. */
const CONSOLE_PREFIX = '/_db3/console';
/** Largest upload passed through to the app. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** How long Dock waits for the app's answer. */
const TIMEOUT_MS = 30_000;

/** Why the console can't be reached, as a plain message with a status. */
class ConsoleUnavailable extends Error {
	constructor(message: string, readonly statusCode: number) {
		super(message);
	}
}

/**
 * Passes `/api/projects/:id/console/*` through to the project's running app at `/_db3/console/*`,
 * adding the project's console token. The browser never holds the token, and the app only
 * answers Dock. The app's port is found among the ports its web and api processes listen on, by
 * asking each in turn, since a dev script often runs Vite and the API side by side.
 *
 * @param server - Dock's HTTP server.
 * @param dock - Opened Dock.
 * @param keys - Console tokens.
 * @param fetchImpl - Fetch, replaceable in tests.
 */
export async function registerConsoleRoutes(server: FastifyInstance, dock: Dock, keys: ConsoleKeys, fetchImpl: typeof fetch = fetch): Promise<void> {
	/** The port that answered last time, per project. */
	const known = new Map<string, number>();

	async function locate(projectId: string, token: string): Promise<number> {
		const state = dock.state();
		const project = state.projects.find(item => item.id === projectId);
		if (!project) throw new ConsoleUnavailable('That project is not in Dock.', 404);
		const running = state.processes.filter(item => item.projectId === projectId && item.status === 'running');
		const candidates = candidatePorts(running, project.processes.filter(item => item.kind === 'web' || item.kind === 'api').map(item => item.id));
		if (!candidates.length) throw new ConsoleUnavailable(`Start ${project.name}'s web or api process to open its console.`, 409);
		const remembered = known.get(projectId);
		const ordered = remembered && candidates.includes(remembered) ? [remembered, ...candidates.filter(port => port !== remembered)] : candidates;
		let refused = false;
		for (const port of ordered) {
			const response = await fetchImpl(`http://127.0.0.1:${port}${CONSOLE_PREFIX}/`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) }).catch(() => null);
			if (!response) continue;
			// A dev server such as Vite answers every path with its page, so only the console's own answer counts.
			const answer = response.ok && /json/.test(response.headers.get('content-type') ?? '') ? await response.json().catch(() => null) as { database?: unknown } | null : null;
			if (!answer) await response.body?.cancel().catch(() => {});
			if (answer && typeof answer === 'object' && 'database' in answer) { known.set(projectId, port); return port; }
			if (response.status === 401) refused = true;
		}
		known.delete(projectId);
		if (refused) throw new ConsoleUnavailable(`${project.name} was not started by Dock, so it doesn't have Dock's console token. Restart its web process from Dock.`, 409);
		throw new ConsoleUnavailable(`${project.name} doesn't answer the console API. Update it to a framework version with the console (registerConsoleRoutes in its server).`, 501);
	}

	await server.register(async scope => {
		scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_request, body, done) => done(null, body));

		scope.route<{ Params: { id: string; '*': string } }>({
			method: ['GET', 'POST', 'PUT', 'DELETE'],
			url: '/api/projects/:id/console/*',
			bodyLimit: MAX_UPLOAD_BYTES,
			handler: async (request, reply) => {
				const project = dock.state().projects.find(item => item.id === request.params.id);
				if (!project) return reply.code(404).send({ message: 'That project is not in Dock.' });
				const token = keys.token(project.path);
				const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
				const path = request.params['*'] ?? '';
				try {
					const port = await locate(project.id, token);
					const body = request.method === 'GET' || request.body === undefined ? undefined : Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body);
					const response = await fetchImpl(`http://127.0.0.1:${port}${CONSOLE_PREFIX}/${path}${query}`, {
						method: request.method,
						headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': Buffer.isBuffer(request.body) ? 'application/octet-stream' : 'application/json' } : {}) },
						body: body as BodyInit | undefined,
						signal: AbortSignal.timeout(TIMEOUT_MS),
					});
					return relay(reply, response);
				} catch (error) {
					if (error instanceof ConsoleUnavailable) return reply.code(error.statusCode).send({ message: error.message });
					known.delete(project.id);
					return reply.code(502).send({ message: `${project.name} did not answer: ${error instanceof Error ? error.message : String(error)}` });
				}
			},
		});
	});
}

/** Ports to try: the main port of each web or api process first, then the others they listen on. */
export function candidatePorts(running: ProcessSnapshot[], webIds: string[]): number[] {
	const preferred = running.filter(item => webIds.includes(item.id));
	const ports = [...preferred.map(item => item.port), ...preferred.flatMap(item => item.ports), ...running.map(item => item.port), ...running.flatMap(item => item.ports)];
	return [...new Set(ports.filter((port): port is number => typeof port === 'number' && port > 0))];
}

/** Sends the app's answer back as it came: status, type, download name and body. */
async function relay(reply: FastifyReply, response: Response): Promise<FastifyReply> {
	reply.code(response.status).header('cache-control', 'no-store');
	for (const name of ['content-type', 'content-disposition', 'content-length', 'x-content-type-options']) {
		const value = response.headers.get(name);
		if (value) reply.header(name, value);
	}
	return reply.send(Buffer.from(await response.arrayBuffer()));
}
