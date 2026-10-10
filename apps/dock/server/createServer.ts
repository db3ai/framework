import { existsSync } from 'node:fs';

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

import type { AddProcessRequest, DockEvent } from '../shared/contracts.js';
import type { Dock } from './Dock.js';
import { desktopStatus, openDesktop } from './desktopApp.js';
import { openInEditor } from './openInEditor.js';
import { attachTerminalSocket } from './terminalSocket.js';
import { DockRequestError } from './projects/ProjectStore.js';
import { readPackageScripts } from './projects/readPackageScripts.js';
import { scanQueueTopology } from './projects/scanQueueTopology.js';

/** HTTP server options. */
export interface DockServerOptions {
	/** Built client folder to serve; omitted in development, where Vite serves it. */
	clientDir?: string;
	/** Editor command for "Open in editor". */
	editor?: string;
	/** Log requests. */
	logger?: boolean;
	/** The `apps/dock` folder, for launching the desktop shell. */
	dockDir?: string;
	/** Port this server listens on, passed to the desktop shell. */
	port?: number;
}

/**
 * Creates the loopback HTTP API and event stream for a {@link Dock}.
 *
 * This server can start and stop arbitrary npm scripts on this machine, so it
 * must only listen on a loopback address. Requests with a non-local `Origin`
 * or `Host` are rejected to stop other websites (including DNS-rebinding
 * pages) driving it from a browser.
 *
 * @param dock - Opened Dock instance.
 * @param options - Static files and editor.
 * @returns Configured Fastify server (not yet listening).
 */
export async function createServer(dock: Dock, options: DockServerOptions = {}): Promise<FastifyInstance> {
	const server = Fastify({ logger: options.logger ?? false });

	server.addHook('onRequest', async (request, reply) => {
		const origin = request.headers.origin;
		const host = request.headers.host ?? '';
		if (!isLoopbackOrigin(`http://${host}`) || (origin && !isLoopbackOrigin(origin))) {
			await reply.code(403).send({ error: 'Dock only accepts requests from this machine.' });
		}
	});

	server.setErrorHandler((error, _request, reply) => {
		if (error instanceof DockRequestError) return reply.code(error.statusCode).send({ error: error.message });
		const status = (error as { statusCode?: number }).statusCode ?? 500;
		return reply.code(status).send({ error: status < 500 ? (error as Error).message : 'Dock could not complete that request.' });
	});

	server.get('/api/health', async () => ({ ok: true, app: 'db3-dock' }));

	server.get('/api/state', async () => dock.state());

	server.get('/api/desktop', async () => {
		if (!options.dockDir) return { installed: false, installCommand: '' };
		return desktopStatus(options.dockDir);
	});

	server.post('/api/desktop/open', async request => {
		if (!options.dockDir) throw new DockRequestError('The desktop app is not available here.', 404);
		// Show the page the user is on (the Vite dev server in development), if it is local.
		const origin = request.headers.origin;
		const uiUrl = origin && isLoopbackOrigin(origin) ? origin : `http://127.0.0.1:${options.port ?? 8790}`;
		await openDesktop(options.dockDir, { port: options.port ?? 8790, uiUrl }).catch(error => {
			throw new DockRequestError(`Could not open the desktop app: ${(error as Error).message}`);
		});
		return { ok: true };
	});

	server.get('/api/events', (request, reply) => {
		reply.raw.writeHead(200, {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive',
		});
		const send = (event: DockEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
		send({ type: 'state', state: dock.state() });
		const unsubscribe = dock.subscribe(send);
		const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15000);
		request.raw.on('close', () => {
			clearInterval(heartbeat);
			unsubscribe();
		});
	});

	server.post<{ Body: { path?: string; name?: string } }>('/api/projects', async request => {
		if (!request.body?.path) throw new DockRequestError('A folder path is required.');
		return dock.addProject(request.body.path, request.body.name);
	});

	server.delete<{ Params: { id: string } }>('/api/projects/:id', async request => {
		await dock.removeProject(request.params.id);
		return { ok: true };
	});

	server.get<{ Params: { id: string } }>('/api/projects/:id/scripts', async request => {
		const project = dock.store.get(request.params.id);
		return { scripts: (await readPackageScripts(project.path)).scripts };
	});

	server.get<{ Params: { id: string } }>('/api/projects/:id/queues', async request => {
		const project = dock.store.get(request.params.id);
		return scanQueueTopology(project.path);
	});

	server.post<{ Params: { id: string }; Body: AddProcessRequest }>('/api/projects/:id/processes', async request => {
		return { processes: await dock.addProcesses(request.params.id, request.body) };
	});

	server.post<{ Params: { id: string; action: string } }>('/api/projects/:id/:action', async request => {
		const { id, action } = request.params;
		if (action === 'open-editor') {
			await openInEditor(dock.store.get(id).path, options.editor ?? 'cursor').catch(error => {
				throw new DockRequestError(`Could not run "${options.editor ?? 'cursor'}": ${(error as Error).message}`);
			});
			return { ok: true };
		}
		if (action !== 'start' && action !== 'stop' && action !== 'restart') throw new DockRequestError(`Unknown action "${action}".`, 404);
		await dock.projectAction(id, action);
		return { ok: true };
	});

	server.delete<{ Params: { id: string } }>('/api/processes/:id', async request => {
		await dock.removeProcess(request.params.id);
		return { ok: true };
	});

	server.get<{ Params: { id: string }; Querystring: { after?: string } }>('/api/processes/:id/output', async request => {
		const after = Number(request.query.after ?? 0) || 0;
		return { chunks: dock.output(request.params.id, after) };
	});

	// Raw keystrokes for scripts and tests; panes use the terminal WebSocket.
	server.post<{ Params: { id: string }; Body: { text?: string } }>('/api/processes/:id/input', async request => {
		dock.write(request.params.id, String(request.body?.text ?? ''));
		return { ok: true };
	});

	server.post<{ Params: { id: string; action: string } }>('/api/processes/:id/:action', async request => {
		const { id, action } = request.params;
		if (action === 'start') dock.start(id);
		else if (action === 'stop') await dock.stop(id);
		else if (action === 'restart') await dock.restart(id);
		else if (action === 'clear') dock.clear(id);
		else throw new DockRequestError(`Unknown action "${action}".`, 404);
		return { ok: true };
	});

	if (options.clientDir && existsSync(options.clientDir)) {
		await server.register(fastifyStatic, { root: options.clientDir });
		server.setNotFoundHandler((request, reply) => {
			if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found.' });
			return reply.sendFile('index.html');
		});
	}

	const closeTerminalSocket = attachTerminalSocket(server.server, dock, isLoopbackOrigin);
	server.addHook('onClose', async () => closeTerminalSocket());

	return server;
}

/**
 * @param origin - Request `Origin` header.
 * @returns Whether it is a loopback http(s) origin.
 */
export function isLoopbackOrigin(origin: string): boolean {
	try {
		const url = new URL(origin);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
		return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
	} catch {
		return false;
	}
}
