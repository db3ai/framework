import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Dock } from '../server/Dock.js';
import { ProjectStore } from '../server/projects/ProjectStore.js';
import { caddyRoutes } from '../server/proxies/readCaddyRoutes.js';
import { pickListeningPort } from '../shared/pickListeningPort.js';
import { portLink } from '../shared/portLink.js';
import { createFixtureProject, type FixtureProject } from './fixtures/createFixtureProject.js';

function proxy(port: number) {
	return { handler: 'subroute', routes: [{ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `127.0.0.1:${port}` }] }] }] };
}

/** Shaped like a Caddyfile with `reverse_proxy`, a path-split site and a PHP site, adapted to JSON. */
const config = {
	apps: { http: { servers: { srv0: {
		listen: [':443'],
		routes: [
			{ match: [{ host: ['local.growthscout.io'] }], handle: [proxy(8000)], terminal: true },
			{ match: [{ host: ['local.db3.ai'] }], handle: [{ handler: 'subroute', routes: [
				{ group: 'g', match: [{ path: ['/framework', '/framework/*'] }], handle: [proxy(8300)] },
				{ group: 'g', handle: [proxy(8500)] },
			] }], terminal: true },
			{ match: [{ host: ['newicon.test'] }], handle: [{ handler: 'subroute', routes: [
				{ match: [{ path: ['*.php'] }], handle: [{ handler: 'reverse_proxy', transport: { protocol: 'fastcgi' }, upstreams: [{ dial: '127.0.0.1:9000' }] }] },
			] }] },
			{ match: [{ host: ['*.wild.test', 'remote.test'] }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: '10.0.0.2:8000' }] }] },
		],
	}, dev: { listen: [':8080'], routes: [{ match: [{ host: ['plain.test'] }], handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'localhost:3000' }] }] }] } } } },
};

describe('caddyRoutes', () => {
	it('maps hosts and path prefixes to local upstream ports', () => {
		expect(caddyRoutes(config)).toEqual([
			{ url: 'https://local.growthscout.io', port: 8000 },
			{ url: 'https://local.db3.ai/framework', port: 8300 },
			{ url: 'https://local.db3.ai', port: 8500 },
			{ url: 'http://plain.test:8080', port: 3000 },
		]);
	});

	it('tolerates an empty or unexpected config', () => {
		expect(caddyRoutes(null)).toEqual([]);
		expect(caddyRoutes({ apps: {} })).toEqual([]);
	});
});

describe('portLink', () => {
	const routes = caddyRoutes(config);

	it('prefers a proxied domain, whole host before path prefix', () => {
		expect(portLink(8000, routes)).toEqual({ href: 'https://local.growthscout.io/', label: 'local.growthscout.io', title: 'https://local.growthscout.io\nhttp://localhost:8000' });
		expect(portLink(8300, routes).label).toBe('local.db3.ai/framework');
		expect(portLink(8300, [...routes, { url: 'https://framework.test', port: 8300 }]).label).toBe('framework.test');
	});

	it('falls back to localhost', () => {
		expect(portLink(5173, routes)).toEqual({ href: 'http://localhost:5173/', label: ':5173', title: 'http://localhost:5173' });
	});
});

describe('Dock proxies and listening ports', () => {
	let fixture: FixtureProject;
	let dock: Dock;
	let ports = new Map<number, number[]>();

	beforeEach(async () => {
		fixture = await createFixtureProject();
		dock = new Dock(new ProjectStore(fixture.configFile), {
			sampleEveryMs: 0,
			discoverEveryMs: 0,
			proxiesEveryMs: 0,
			scan: async () => ({ jobs: [], ports }),
			listProxies: async () => [{ url: 'https://local.demo.test', port: 8000 }],
		});
		await dock.open();
	});

	afterEach(async () => {
		await dock.close();
		await fixture.dispose();
	});

	it('includes proxy routes in state and fills a silent process port from listening sockets', async () => {
		const project = await dock.addProject(fixture.path);
		expect(dock.state().proxies).toEqual([{ url: 'https://local.demo.test', port: 8000 }]);

		const scheduler = project.processes.find(process => process.script === 'scheduler')!;
		dock.start(scheduler.id);
		const pid = dock.state().processes.find(process => process.id === scheduler.id)!.pid!;
		ports = new Map([[pid, [52011, 8000]]]);
		await dock.discover();
		expect(dock.state().processes.find(process => process.id === scheduler.id)).toMatchObject({ port: 8000, ports: [52011, 8000] });
	});

	it('keeps a port the process announced as its main port', async () => {
		const project = await dock.addProject(fixture.path);
		const dev = project.processes.find(process => process.script === 'dev')!;
		dock.start(dev.id);
		const state = () => dock.state().processes.find(process => process.id === dev.id)!;
		const deadline = Date.now() + 15000;
		while (state().port !== 45173 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
		ports = new Map([[state().pid!, [8000, 45173]]]);
		await dock.discover();
		expect(state()).toMatchObject({ port: 45173, ports: [8000, 45173] });
	});
});

describe('pickListeningPort', () => {
	it('prefers proxied, then fixed ports over random ephemeral ones', () => {
		expect(pickListeningPort([49825], new Set())).toBe(49825);
		expect(pickListeningPort([], new Set())).toBeNull();
		expect(pickListeningPort([49825, 8000], new Set())).toBe(8000);
		expect(pickListeningPort([3000, 8000], new Set([8000]))).toBe(8000);
		expect(pickListeningPort([50123], new Set([50123]))).toBe(50123);
	});
});
