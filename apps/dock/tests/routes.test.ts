import { describe, expect, it } from 'vitest';

import type { HostSnapshot } from '../shared/hostContracts.js';
import { buildTopology } from '../server/hosts/buildTopology.js';
import { buildRouteGraph, focusOn, ROUTE_WIDTH_RANGE, routeNodeHeight, routesThrough } from '../client/routes/buildRouteGraph.js';
import { scoutFixture } from './fixtures/hostFixture.js';

/** The Scout fixture behind two tunnels: one shared by several apps, one catch-all. */
function host(): HostSnapshot {
	const input = scoutFixture();
	const tunnel = (name: string, project: string) => ({ id: name, name, image: 'cloudflare/cloudflared', command: 'cloudflared tunnel run', state: 'running', status: 'Up', project, service: 'tunnel', replica: 1, workingDir: null, networks: ['edge'], ports: [] });
	input.ps.push(tunnel('edge-cloudflared-1', 'edge'), tunnel('scout-hosted-blog-tunnel-1', 'scout-hosted-blog'));
	input.ps.push({ id: 'c', name: 'coaster-app-1', image: 'node', command: 'node server/index.ts', state: 'running', status: 'Up', project: 'coaster', service: 'app', replica: 1, workingDir: null, networks: ['edge'], ports: [{ port: 8400, protocol: 'tcp', hostIp: '0.0.0.0', hostPort: 8400 }] });
	const log = (ingress: Array<{ hostname: string | null; service: string }>) => ({ id: null, version: null, metricsPort: null, configVersion: 1, configAt: null, reconnects: 4, ingress });
	input.tunnelLogs = new Map([
		['edge-cloudflared-1', log([{ hostname: 'growthscout.io', service: 'http://growthscout:80' }, { hostname: 'coaster.example', service: 'http://coaster-app-1:8400' }, { hostname: 'gone.example', service: 'http://missing:80' }, { hostname: null, service: 'http_status:404' }])],
		['scout-hosted-blog-tunnel-1', log([{ hostname: null, service: 'http://growthscout:80' }])],
	]);
	const { containers, apps } = buildTopology(input);
	return { id: 'm', name: 'mac-server', target: '', status: 'online', error: null, sampledAt: 0, latencyMs: 0, engine: null, disks: null, containers, apps, activity: [] };
}

describe('route graph', () => {
	it('lays hostnames, tunnels, proxies and slots out in columns', () => {
		const graph = buildRouteGraph(host());
		const column = (name: string) => graph.nodes.filter(item => item.column === name).map(item => item.id).sort();
		expect(column('entry')).toEqual(['any:scout-hosted-blog-tunnel-1', 'host:coaster.example', 'host:gone.example', 'host:growthscout.io', 'port:8400']);
		expect(column('tunnel')).toEqual(['container:edge-cloudflared-1', 'container:scout-hosted-blog-tunnel-1']);
		expect(column('proxy')).toEqual(['container:scout-gateway-1']);
		expect(column('destination')).toEqual(['container:coaster-app-1', 'missing:http://missing:80', 'slot:scout-blue', 'slot:scout-green']);
		// Columns sit side by side, and boxes in a column never overlap.
		const xs = [...new Set(graph.nodes.map(item => item.x))].sort((a, b) => a - b);
		expect(xs).toHaveLength(4);
		for (const x of xs) {
			const stack = graph.nodes.filter(item => item.x === x).sort((a, b) => a.y - b.y);
			for (let index = 1; index < stack.length; index++) expect(stack[index]!.y).toBeGreaterThanOrEqual(stack[index - 1]!.y + stack[index - 1]!.height);
		}
	});

	it('marks live, standby and broken routes', () => {
		const graph = buildRouteGraph(host());
		const state = (source: string, target: string) => graph.edges.find(item => item.source === source && item.target === target)?.state;
		expect(state('container:scout-gateway-1', 'slot:scout-blue')).toBe('live');
		expect(state('container:scout-gateway-1', 'slot:scout-green')).toBe('standby');
		expect(state('container:edge-cloudflared-1', 'missing:http://missing:80')).toBe('broken');
		expect(state('port:8400', 'container:coaster-app-1')).toBe('live');
		const green = graph.nodes.find(item => item.id === 'slot:scout-green')!;
		expect(green).toMatchObject({ state: 'standby', select: 'scout-green-web-1', slot: { running: 1, total: 3, problem: 'api stopped' } });
	});

	it('lists a proxy’s rules with their fallbacks only when expanded', () => {
		expect(buildRouteGraph(host()).nodes.find(item => item.id === 'container:scout-gateway-1')!.rules).toEqual([]);
		const gateway = buildRouteGraph(host(), { expanded: new Set(['scout-gateway-1']) }).nodes.find(item => item.id === 'container:scout-gateway-1')!;
		expect(gateway.rules).toEqual([{ path: '/assets/', target: 'scout_active → scout-blue', fallback: '@previous_assets → scout-green', state: 'live' }]);
		expect(gateway.height).toBe(routeNodeHeight(gateway));
	});

	it('filters to the paths through a match, crossing shared tunnels by hostname', () => {
		const ids = (filter: string) => buildRouteGraph(host(), { filter }).nodes.map(item => item.id).sort();
		// coaster shares the edge tunnel with Scout, but none of Scout's routes.
		expect(ids('coaster')).toEqual(['container:coaster-app-1', 'container:edge-cloudflared-1', 'host:coaster.example', 'port:8400']);
		expect(ids('scout-green')).toEqual(['any:scout-hosted-blog-tunnel-1', 'container:edge-cloudflared-1', 'container:scout-gateway-1', 'container:scout-hosted-blog-tunnel-1', 'host:growthscout.io', 'slot:scout-green']);
		expect(ids('nothing-here')).toEqual([]);
	});

	it('picks out the lines through a focused box', () => {
		const graph = buildRouteGraph(host());
		const focus = routesThrough(graph, ['host:growthscout.io']);
		// Through the shared tunnel to Scout's gateway and slots, not to coaster or the missing target.
		expect([...focus.edges].sort()).toEqual([
			'container:edge-cloudflared-1->container:scout-gateway-1',
			'container:scout-gateway-1->slot:scout-blue',
			'container:scout-gateway-1->slot:scout-green',
			'host:growthscout.io->container:edge-cloudflared-1',
		]);
		expect(routesThrough(graph, ['container:edge-cloudflared-1']).edges.has('container:edge-cloudflared-1->container:coaster-app-1')).toBe(true);
	});

	it('expands a slot into its containers, with routes landing on the one that serves', () => {
		const graph = buildRouteGraph(host(), { expanded: new Set(['scout-blue']) });
		const blue = graph.nodes.find(item => item.id === 'slot:scout-blue')!;
		expect(blue.members).toEqual(['container:scout-blue-web-1', 'container:scout-blue-api-1', 'container:scout-blue-worker-1']);
		const members = graph.nodes.filter(item => item.parent === 'slot:scout-blue');
		expect(members.map(item => item.label)).toEqual(['web', 'api', 'worker: shared']);
		// Members sit inside the slot box, one under another.
		for (const member of members) expect(member.y + member.height).toBeLessThanOrEqual(blue.height);
		const edge = (source: string, target: string) => graph.edges.find(item => item.source === source && item.target === target);
		expect(edge('container:scout-gateway-1', 'container:scout-blue-web-1')).toMatchObject({ state: 'live', tint: 'blue' });
		expect(edge('container:scout-blue-web-1', 'container:scout-blue-api-1')).toMatchObject({ state: 'live', tint: 'blue' });
		expect(edge('container:scout-gateway-1', 'slot:scout-blue')).toBeUndefined();
		// Green stays one box, and its line is green.
		expect(edge('container:scout-gateway-1', 'slot:scout-green')).toMatchObject({ state: 'standby', tint: 'green' });
	});

	it('treats an expanded slot as selected: its routes stay lit and none of its containers fade', () => {
		const graph = buildRouteGraph(host(), { expanded: new Set(['scout-blue']) });
		const slot = focusOn(graph, 'slot:scout-blue');
		expect([...slot.edges].sort()).toEqual([
			'any:scout-hosted-blog-tunnel-1->container:scout-hosted-blog-tunnel-1',
			'container:edge-cloudflared-1->container:scout-gateway-1',
			'container:scout-blue-web-1->container:scout-blue-api-1',
			'container:scout-gateway-1->container:scout-blue-web-1',
			'container:scout-hosted-blog-tunnel-1->container:scout-gateway-1',
			'host:growthscout.io->container:edge-cloudflared-1',
		]);
		expect(slot.nodes.has('slot:scout-green')).toBe(false);
		expect(slot.nodes.has('host:coaster.example')).toBe(false);
		// Focusing the worker, which nothing routes to, still keeps its siblings and their line.
		const worker = focusOn(graph, 'container:scout-blue-worker-1');
		expect(['container:scout-blue-web-1', 'container:scout-blue-api-1', 'slot:scout-blue'].every(id => worker.nodes.has(id))).toBe(true);
		expect(worker.edges.has('container:scout-blue-web-1->container:scout-blue-api-1')).toBe(true);
	});

	it('sizes boxes and columns to the chosen width, within limits', () => {
		const wide = buildRouteGraph(host(), { width: 400, expanded: new Set(['scout-blue']) });
		const xs = [...new Set(wide.nodes.filter(item => !item.parent).map(item => item.x))].sort((a, b) => a - b);
		expect(xs[1]! - xs[0]!).toBe(400 + 90);
		expect(wide.nodes.find(item => item.id === 'container:scout-blue-web-1')!.width).toBe(400 - 20);
		expect(buildRouteGraph(host(), { width: 5000 }).nodes[0]!.width).toBe(ROUTE_WIDTH_RANGE.max);
	});
});
