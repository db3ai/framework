import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ConsoleError } from '@db3.ai/app/console';
import { registerConsoleRoutes as registerRoutes } from '@db3.ai/app/console/fastify';
import { openProjectConsole, type ProjectConsole } from '@db3.ai/app/console/project';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Dock } from '../Dock.js';

/** One project's open console, and the .env it was opened with. */
type Opened = { path: string; env: string; console: Promise<ProjectConsole> };

/**
 * Serves the console (Database, Storage, Flows) for each project at `/api/projects/:id/console`.
 * Dock opens the project itself, from its folder: the database its `.env` names, its local
 * storage and its `db3/` definitions. The app doesn't serve anything for this, and doesn't need
 * to be running. A project is reopened when its folder or `.env` changes.
 *
 * @param server - Dock's HTTP server, which only listens on this machine.
 * @param dock - Opened Dock.
 */
export async function registerConsoleRoutes(server: FastifyInstance, dock: Dock): Promise<void> {
	const opened = new Map<string, Opened>();

	async function open(request: FastifyRequest) {
		const id = (request.params as { id?: string }).id ?? '';
		const project = dock.state().projects.find(item => item.id === id);
		if (!project) throw new ConsoleError('That project is not in Dock.', 404);
		const env = await stat(join(project.path, '.env')).then(info => `${info.mtimeMs}:${info.size}`, () => 'none');
		const known = opened.get(id);
		if (known && known.path === project.path && known.env === env) return (await known.console).services;
		if (known) void known.console.then(item => item.close()).catch(() => {});
		const next: Opened = { path: project.path, env, console: openProjectConsole(project.path, { name: project.name }) };
		opened.set(id, next);
		next.console.catch(() => opened.delete(id));
		return (await next.console).services;
	}

	server.addHook('onClose', async () => {
		await Promise.all([...opened.values()].map(item => item.console.then(entry => entry.close()).catch(() => {})));
	});
	await registerRoutes(server, '/api/projects/:id/console', open);
}
