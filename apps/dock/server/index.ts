import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from './createServer.js';
import { Dock } from './Dock.js';
import { ProjectStore } from './projects/ProjectStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DOCK_PORT || 8790);
const host = process.env.DOCK_HOST || '127.0.0.1';
const configFile = resolve(process.env.DOCK_CONFIG || join(homedir(), '.db3-dock', 'projects.json'));

if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
	console.error(`DOCK_HOST must be a loopback address; Dock runs commands on this machine. Got "${host}".`);
	process.exit(1);
}

const dock = new Dock(new ProjectStore(configFile));
await dock.open();

const server = await createServer(dock, {
	clientDir: process.env.DOCK_CLIENT_DIR ?? join(here, '..', 'dist'),
	editor: process.env.DOCK_EDITOR || 'cursor',
	logger: process.env.DOCK_LOG === '1',
	dockDir: join(here, '..'),
	port,
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
	if (closing) return;
	closing = true;
	console.log(`\n${signal}: stopping supervised processes…`);
	await dock.close();
	await server.close();
	process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await server.listen({ port, host });
console.log(`Dock API on http://${host}:${port} (config ${configFile})`);
if (process.env.DOCK_AUTOSTART === '1') {
	for (const project of dock.store.list()) await dock.projectAction(project.id, 'start');
}
