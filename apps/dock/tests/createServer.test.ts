import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import WebSocket from 'ws';

import { stripAnsi } from '../shared/ansi.js';
import { createServer, isLoopbackOrigin } from '../server/createServer.js';
import { parseTerminalMessage } from '../server/terminalSocket.js';
import { Dock } from '../server/Dock.js';
import { ProjectStore } from '../server/projects/ProjectStore.js';
import { createFixtureProject, type FixtureProject } from './fixtures/createFixtureProject.js';

let fixture: FixtureProject;
let dock: Dock;
let server: FastifyInstance;

beforeEach(async () => {
	fixture = await createFixtureProject();
	dock = new Dock(new ProjectStore(fixture.configFile), { sampleEveryMs: 0, discoverEveryMs: 0, scan: async () => ({ jobs: [], ports: new Map() }), listProxies: async () => [] });
	await dock.open();
	server = await createServer(dock);
});

afterEach(async () => {
	await server.close();
	await dock.close();
	await fixture.dispose();
});

describe('Dock HTTP API', () => {
	it('accepts only loopback hosts and origins', async () => {
		expect((await server.inject({ url: '/api/health' })).statusCode).toBe(200);
		expect((await server.inject({ url: '/api/health', headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
		expect((await server.inject({ url: '/api/health', headers: { host: 'rebind.example:8790' } })).statusCode).toBe(403);
		expect(isLoopbackOrigin('http://127.0.0.1:5179')).toBe(true);
		expect(isLoopbackOrigin('http://dock.localhost')).toBe(true);
		expect(isLoopbackOrigin('file://')).toBe(false);
	});

	it('adds a project and lists its scripts, queues and state', async () => {
		const added = await server.inject({ method: 'POST', url: '/api/projects', payload: { path: fixture.path, name: 'Demo' } });
		expect(added.statusCode).toBe(200);
		const project = added.json();
		expect(project.name).toBe('Demo');

		const scripts = (await server.inject({ url: `/api/projects/${project.id}/scripts` })).json().scripts;
		expect(scripts.map((script: { name: string }) => script.name)).toEqual(['dev', 'queue', 'scheduler', 'db:migrate']);

		const queues = (await server.inject({ url: `/api/projects/${project.id}/queues` })).json();
		expect(queues.pools).toEqual(['content', 'general']);

		const state = (await server.inject({ url: '/api/state' })).json();
		expect(state.projects).toHaveLength(1);
		expect(state.processes).toHaveLength(3);
		expect(state.processes[0].status).toBe('stopped');
	});

	it('reports whether the desktop app can be opened', async () => {
		const withoutDir = (await server.inject({ url: '/api/desktop' })).json();
		expect(withoutDir.installed).toBe(false);
		expect((await server.inject({ method: 'POST', url: '/api/desktop/open' })).statusCode).toBe(404);

		const withDir = await createServer(dock, { dockDir: fixture.path });
		const status = (await withDir.inject({ url: '/api/desktop' })).json();
		expect(status).toEqual({ installed: false, installCommand: `cd ${fixture.path}/electron && npm install --workspaces=false` });
		const open = await withDir.inject({ method: 'POST', url: '/api/desktop/open' });
		expect(open.statusCode).toBe(400);
		expect(open.json().error).toMatch(/not installed/);
		await withDir.close();
	});

	it('reports bad requests with their message', async () => {
		const missing = await server.inject({ method: 'POST', url: '/api/projects', payload: { path: fixture.root } });
		expect(missing.statusCode).toBe(400);
		expect(missing.json().error).toMatch(/package\.json/);

		const unknown = await server.inject({ method: 'POST', url: '/api/processes/nope/start' });
		expect(unknown.statusCode).toBe(404);

		const added = (await server.inject({ method: 'POST', url: '/api/projects', payload: { path: fixture.path } })).json();
		const noScript = await server.inject({ method: 'POST', url: `/api/projects/${added.id}/processes`, payload: { script: '', args: [], name: '', count: 1, save: false, start: false } });
		expect(noScript.statusCode).toBe(400);
	});

	it('takes keystrokes over the terminal WebSocket and refuses other origins', async () => {
		const project = (await server.inject({ method: 'POST', url: '/api/projects', payload: { path: fixture.path } })).json();
		const dev = project.processes.find((process: { script: string }) => process.script === 'dev');
		await server.inject({ method: 'POST', url: `/api/processes/${dev.id}/start` });
		const address = await server.listen({ port: 0, host: '127.0.0.1' });
		const url = `${address.replace('http', 'ws')}/api/terminal`;

		const socket = new WebSocket(url, { origin: address });
		await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
		socket.send(JSON.stringify({ type: 'input', id: dev.id, data: 'over-socket\r' }));
		const output = () => stripAnsi(dock.output(dev.id).map(chunk => chunk.data).join(''));
		const deadline = Date.now() + 15000;
		while (!output().includes('echo:over-socket') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
		expect(output()).toContain('echo:over-socket');
		socket.close();

		const foreign = new WebSocket(url, { origin: 'https://evil.example' });
		const refused = await new Promise<number>(resolve => foreign.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0)).once('error', () => resolve(-1)));
		expect([403, -1]).toContain(refused);
	});

	it('validates terminal messages', () => {
		expect(parseTerminalMessage('{"type":"input","id":"p1","data":"ls\\r"}')).toEqual({ type: 'input', id: 'p1', data: 'ls\r' });
		expect(parseTerminalMessage('{"type":"resize","id":"p1","cols":80,"rows":24}')).toEqual({ type: 'resize', id: 'p1', cols: 80, rows: 24 });
		expect(parseTerminalMessage('{"type":"input","id":"","data":"x"}')).toBeNull();
		expect(parseTerminalMessage('{"type":"resize","id":"p1","cols":"wide"}')).toBeNull();
		expect(parseTerminalMessage('not json')).toBeNull();
	});
});
