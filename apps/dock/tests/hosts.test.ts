import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appResolver, buildTopology, inferRole, shortCommand, slotOf, workerPool } from '../server/hosts/buildTopology.js';
import { HostStore } from '../server/hosts/HostStore.js';
import { HostWatcher } from '../server/hosts/HostWatcher.js';
import { cpuPercent, labelFromList, parseApiStats, parseEvent, parseInspect, parsePorts, parsePs, parseSize, splitSections, type InspectRow, type PsRow } from '../server/hosts/parseDocker.js';
import { cpuQuantity, memoryQuantity, parseKubeNodes, parseKubePods } from '../server/hosts/parseKube.js';
import { parseNginxRoutes, upstreamRole } from '../server/hosts/parseNginxRoutes.js';
import { LISTEN_OK, NO_MOUNTS, parseAccessCounts, parseDisks, parseListening, parseTunnelLog, parseTunnelMetrics } from '../server/hosts/parseRuntime.js';
import { RemoteShell } from '../server/hosts/RemoteShell.js';
import { scoutFixture } from './fixtures/hostFixture.js';
import { KUBE_METRICS, KUBE_NODES, KUBE_PODS } from './fixtures/kubeFixture.js';
import { confirmAction, containerDetail, containerLabel, diskState, formatDisk, formatPorts, hostWarnings, requestSummary } from '../client/hosts/presentation.js';

describe('Docker output parsing', () => {
	it('reads labels whose values contain commas', () => {
		const labels = 'com.docker.compose.project.config_files=/a/release.yml,/a/images.yml,com.docker.compose.project=scout-blue,com.docker.compose.service=worker';
		expect(labelFromList(labels, 'com.docker.compose.project.config_files')).toBe('/a/release.yml,/a/images.yml');
		expect(labelFromList(labels, 'com.docker.compose.project')).toBe('scout-blue');
		expect(labelFromList(labels, 'com.docker.compose.service')).toBe('worker');
	});

	it('parses ps rows, ports and sizes', () => {
		const [row] = parsePs([JSON.stringify({
			ID: 'abc', Names: 'scout-db-1', Image: 'mariadb:12.3', Command: '"docker-entrypoint.sh mariadbd"', State: 'running', Status: 'Up 5 weeks (healthy)',
			Labels: 'com.docker.compose.container-number=1,com.docker.compose.project=scout,com.docker.compose.service=db', Networks: 'scout_default',
			Ports: '127.0.0.1:3307->3306/tcp, [::1]:3307->3306/tcp, 8787/tcp',
		})]);
		expect(row).toMatchObject({ name: 'scout-db-1', project: 'scout', service: 'db', replica: 1, command: 'docker-entrypoint.sh mariadbd', networks: ['scout_default'] });
		expect(row!.ports).toEqual([{ port: 3306, protocol: 'tcp', hostIp: '127.0.0.1', hostPort: 3307 }, { port: 8787, protocol: 'tcp' }]);
		expect(parsePorts('')).toEqual([]);
		expect(parseSize('574.1MiB')).toBeCloseTo(574.1 * 1024 ** 2);
		expect(parseSize('1.06GB')).toBe(1.06e9);
		expect(parseSize('--')).toBeNull();
	});

	it('reads inspect rows with and without a health check', () => {
		const rows = parseInspect([
			JSON.stringify({ id: '1', name: '/web', cmd: ['nginx'], entrypoint: null, image: 'nginx', labels: { 'com.docker.compose.service': 'web', maintainer: 'x' }, networks: { edge: { Aliases: ['web'], DNSNames: ['web', 'growthscout'] } }, state: { StartedAt: '2026-10-11T11:28:58Z', FinishedAt: '0001-01-01T00:00:00Z', ExitCode: 0 }, restartCount: 0, restartPolicy: 'unless-stopped' }),
			JSON.stringify({ id: '2', name: '/api', cmd: [], entrypoint: [], image: 'x', labels: {}, networks: {}, state: { Health: { Status: 'unhealthy', Log: [{ ExitCode: 1, Output: 'connect refused\n' }] }, ExitCode: 0 }, restartCount: 2, restartPolicy: '' }),
		]);
		expect(rows[0]).toMatchObject({ name: 'web', labels: { 'com.docker.compose.service': 'web' }, networks: [{ name: 'edge', aliases: ['web', 'growthscout'] }], health: null, finishedAt: null });
		expect(rows[1]).toMatchObject({ health: 'unhealthy', healthOutput: 'connect refused', restartCount: 2 });
	});

	it('computes CPU from Engine API counters', () => {
		const sample = (total: number, system: number) => JSON.stringify({ name: '/api', cpu_stats: { cpu_usage: { total_usage: total }, system_cpu_usage: system, online_cpus: 4 }, memory_stats: { usage: 1000, limit: 5000, stats: { inactive_file: 200 } }, pids_stats: { current: 7 }, networks: { eth0: { rx_bytes: 10, tx_bytes: 20 }, eth1: { rx_bytes: 5, tx_bytes: 0 } } });
		const first = parseApiStats([sample(1000, 100000)]).get('api')!;
		const second = parseApiStats([sample(3000, 110000)]).get('api')!;
		expect(first).toMatchObject({ memory: 800, memoryLimit: 5000, pids: 7, rx: 15, tx: 20 });
		expect(cpuPercent(undefined, first)).toBeNull();
		expect(cpuPercent(first, second)).toBeCloseTo(80);
	});

	it('splits script sections and filters noisy events', () => {
		expect([...splitSections('@@ps\na\n\n@@nginx gw\nb\n').entries()]).toEqual([['ps', ['a']], ['nginx gw', ['b']]]);
		expect(parseEvent(JSON.stringify({ Type: 'container', Action: 'exec_start: sh', Actor: { Attributes: { name: 'x' } } }))).toBeNull();
		expect(parseEvent(JSON.stringify({ Type: 'container', Action: 'die', timeNano: 2e15, Actor: { Attributes: { name: 'x', exitCode: '137', 'com.docker.compose.project': 'scout-blue' } } }))).toEqual({ time: 2e9, container: 'x', project: 'scout-blue', action: 'die', exitCode: 137 });
	});
});

describe('nginx routes', () => {
	it('reads one-line and multi-line upstreams and direct proxy targets', () => {
		const routes = parseNginxRoutes([
			'upstream db3_docs_active { server db3-site-20261009124935-7faa46a66fa1:8080; keepalive 32; }',
			'upstream scout_previous {',
			'\tserver scout-green:80;',
			'}',
			'proxy_pass http://db3_docs_active;',
			'proxy_pass http://scout-slot-api:8787;',
			'# proxy_pass http://commented:1;',
			'proxy_next_upstream off;',
		].join('\n'));
		expect([...routes.upstreams]).toEqual([['db3_docs_active', ['db3-site-20261009124935-7faa46a66fa1']], ['scout_previous', ['scout-green']]]);
		expect(routes.proxyPasses).toEqual(['db3_docs_active', 'scout-slot-api']);
		expect(upstreamRole('scout_active')).toBe('active');
		expect(upstreamRole('db3_docs_previous')).toBe('previous');
		expect(upstreamRole('backend')).toBe('direct');
	});
});

describe('runtime details', () => {
	it('reads listening sockets, ignoring Docker DNS', () => {
		// 0.0.0.0:8787, 127.0.0.1:9229, 127.0.0.11:39315 (Docker DNS), [::]:8787
		expect(parseListening(['00000000:2253', '0100007F:240D', '0B00007F:9993', '00000000000000000000000000000000:2253', LISTEN_OK])).toEqual([
			{ port: 8787, loopback: false },
			{ port: 9229, loopback: true },
		]);
		expect(parseListening([LISTEN_OK])).toEqual([]);
		expect(parseListening([])).toBeNull();
	});

	it('reads the latest tunnel configuration from its log', () => {
		const log = parseTunnelLog([
			'2026-09-08T12:37:15Z INF Starting tunnel tunnelID=f2944694-0cf8-4f55-b6db-5ad268400337',
			'2026-09-08T12:37:15Z INF Version 2026.7.1 (Checksum abc)',
			'2026-09-08T12:37:15Z INF Starting metrics server on [::]:20241/metrics',
			'2026-09-21T21:27:57Z INF Updated to new configuration config="{\\"ingress\\":[{\\"hostname\\":\\"growthscout.io\\", \\"service\\":\\"http://growthscout:80\\"}, {\\"service\\":\\"http_status:404\\"}]}" version=6',
			'reconnects=14',
		]);
		expect(log).toEqual({
			id: 'f2944694-0cf8-4f55-b6db-5ad268400337', version: '2026.7.1', metricsPort: 20241, configVersion: 6, configAt: Date.parse('2026-09-21T21:27:57Z'), reconnects: 14,
			ingress: [{ hostname: 'growthscout.io', service: 'http://growthscout:80' }, { hostname: null, service: 'http_status:404' }],
		});
	});

	it('reads tunnel metrics and access-log counts', () => {
		expect(parseTunnelMetrics([
			'# HELP x',
			'cloudflared_tunnel_ha_connections 4',
			'cloudflared_tunnel_total_requests 1771',
			'cloudflared_tunnel_request_errors 0',
			'cloudflared_tunnel_response_by_code{status_code="200"} 1041',
			'cloudflared_tunnel_response_by_code{status_code="204"} 1',
			'cloudflared_tunnel_response_by_code{status_code="502"} 7',
		])).toEqual({ connections: 4, requests: 1771, errors: 0, concurrent: null, responses: { '2xx': 1042, '3xx': 0, '4xx': 0, '5xx': 7 } });
		expect(parseTunnelMetrics([])).toBeNull();
		expect(parseAccessCounts('10 20 15 0 4 1')).toEqual({ perSecond: 2, byClass: { '2xx': 1.5, '3xx': 0, '4xx': 0.4, '5xx': 0.1 } });
		expect(parseAccessCounts('')).toBeNull();
	});
});

describe('disk space', () => {
	const GB = 1024 ** 3;

	it('reads df rows, merging paths on one filesystem and dropping config binds', () => {
		const disks = parseDisks([
			'Filesystem     1024-blocks      Used Available Capacity Mounted on',
			'/dev/vda1         61202244  52428800   5652012      91% /var/lib/mysql',
			'/dev/vda1         61202244  52428800   5652012      91% /backups',
			'/dev/vda1         61202244  52428800   5652012      91% /etc/mysql/conf.d/dock.cnf',
			'grpcfuse        976490576 412000000 564490576      43% /srv/uploads',
		]);
		expect(disks).toEqual([
			{ filesystem: '/dev/vda1', paths: ['/var/lib/mysql', '/backups'], size: 61202244 * 1024, used: 52428800 * 1024, free: 5652012 * 1024 },
			{ filesystem: 'grpcfuse', paths: ['/srv/uploads'], size: 976490576 * 1024, used: 412000000 * 1024, free: 564490576 * 1024 },
		]);
		expect(parseDisks(['map auto_home  0 0 0 100% /System/Volumes/Data/home', '/dev/disk3s5 971350180 400000000 571350180 42% /System/Volumes/Data'], true).map(disk => disk.filesystem)).toEqual(['map auto_home', '/dev/disk3s5']);
		expect(diskState(disks[0]!).tone).toBe('warn');
		expect(diskState({ ...disks[0]!, free: GB }).tone).toBe('bad');
		expect(diskState(disks[1]!).tone).toBe('ok');
		expect(formatDisk(disks[0]!)).toBe('5.4 GB free of 58.4 GB');
	});

	it('warns once per nearly full disk, naming the database on it', () => {
		const { containers, apps } = buildTopology(scoutFixture());
		const full = { filesystem: '/dev/vda1', paths: ['/var/lib/mysql'], size: 60 * GB, used: 58 * GB, free: 2.5 * GB };
		for (const container of containers) container.disks = container.role === 'database' || container.role === 'api' ? [full] : [];
		const host = { id: 'm', name: 'm', target: '', status: 'online' as const, error: null, sampledAt: 0, latencyMs: 0, engine: null, kubernetes: null, disks: [{ ...full, paths: ['/'] }], containers, apps, activity: [] };
		const disk = hostWarnings(host).filter(warning => warning.message.includes('full'));
		expect(disk).toEqual([{ container: null, message: 'Disk / is 96% full: 2.5 GB free of 60.0 GB (holds scout-db-1 data)' }]);
		host.disks = [];
		expect(hostWarnings(host).filter(warning => warning.message.includes('full'))).toEqual([{ container: 'scout-db-1', message: 'has /var/lib/mysql on a disk that is 96% full: 2.5 GB free of 60.0 GB' }]);
	});
});

describe('topology', () => {
	it('recognises slots and groups related projects into apps', () => {
		expect(slotOf('scout-blue')).toEqual({ stem: 'scout', label: 'blue' });
		expect(slotOf('db3-site-20261009124935-7faa46a66fa1')).toEqual({ stem: 'db3-site', label: '20261009124935-7faa46a66fa1' });
		expect(slotOf('scout-hosted-blog')).toBeNull();
		const appOf = appResolver(['scout', 'scout-blue', 'scout-green', 'scout-hosted-blog', 'db3-site-data', 'db3-site-20261009124935-7faa46a66fa1', 'db3-docs-blue', 'edge'], [{ name: 'GrowthScout tunnel', match: ['scout-hosted-*'] }]);
		expect(['scout', 'scout-blue', 'scout-green'].map(appOf)).toEqual(['scout', 'scout', 'scout']);
		expect(appOf('scout-hosted-blog')).toBe('GrowthScout tunnel');
		expect(appOf('db3-site-data')).toBe('db3-site');
		expect(appOf('db3-docs-blue')).toBe('db3-docs');
		expect(appOf('edge')).toBe('edge');
	});

	it('infers roles and short commands', () => {
		expect(inferRole('worker', 'sha256:x', 'sh -c exec node --import tsx server/console.ts queue:work --pool=shared')).toBe('worker');
		expect(inferRole('scheduler', '', 'node server/scheduler-console.ts scheduler:work')).toBe('scheduler');
		expect(inferRole('db', 'mariadb:12.3', 'docker-entrypoint.sh mariadbd')).toBe('database');
		expect(inferRole('tunnel', 'cloudflare/cloudflared', 'cloudflared tunnel run')).toBe('tunnel');
		expect(inferRole('api', '', 'node server/index.ts')).toBe('api');
		expect(inferRole('web', '', '/docker-entrypoint.sh nginx -g daemon off;')).toBe('web');
		expect(inferRole('storage-backup', 'rclone/rclone', '/bin/sh backup')).toBe('backup');
		expect(shortCommand('docker-entrypoint.sh node --import tsx server/index.ts')).toBe('node server/index.ts');
		expect(shortCommand("/docker-entrypoint.sh nginx -g 'daemon off;'")).toBe('nginx');
		// --name only sets the process title; the pool or queue list is the work.
		expect(workerPool('node server/console.ts queue:work --pool=images --name=article-images')).toBe('images');
		expect(workerPool('npm run queue -- --queues=emails,default --name=a')).toBe('emails,default');
		expect(workerPool('node server/console.ts queue:work --name=x')).toBeNull();
	});

	it('traces live and standby traffic through blue/green upstreams and slot-private aliases', () => {
		const input = scoutFixture();
		const { containers, apps } = buildTopology(input);
		const by = Object.fromEntries(containers.map(container => [container.name, container]));
		expect(by['scout-gateway-1']).toMatchObject({ role: 'gateway', traffic: 'live', public: true, publicAliases: ['growthscout'], detail: 'scout_active · scout_previous' });
		expect(by['scout-blue-web-1']).toMatchObject({ traffic: 'live', routesIn: [{ from: 'scout-gateway-1', upstream: 'scout_active', role: 'active' }] });
		// Both APIs answer to scout-slot-api, but only on their own slot's network.
		expect(by['scout-blue-api-1']).toMatchObject({ traffic: 'live', routesIn: [{ from: 'scout-blue-web-1', upstream: null, role: 'direct' }] });
		expect(by['scout-green-web-1']).toMatchObject({ traffic: 'standby' });
		expect(by['scout-green-api-1']).toMatchObject({ traffic: 'internal', routesIn: [{ from: 'scout-green-web-1' }] });
		expect(by['scout-blue-worker-1']).toMatchObject({ role: 'worker', detail: 'pool shared', traffic: 'internal', cpu: 2.5, release: '20261011103850-63baa13cb03c-01868' });
		expect(by['scout-db-1']).toMatchObject({ role: 'database', detail: 'mariadb 12.3' });
		expect(containerLabel(by['scout-blue-worker-1']!, false)).toBe('worker: shared');
		expect(containerLabel(by['scout-blue-worker-1']!, true)).toBe('worker: shared 1');
		expect(containerDetail(by['scout-blue-worker-1']!)).toBe('worker service');
		expect(containerLabel(by['scout-blue-api-1']!, false)).toBe('api');
		expect(containerLabel(by['scout-gateway-1']!, false)).toBe('scout-gateway-1');
		const titled = { ...by['scout-gateway-1']!, title: 'Scout gateway', description: 'Switches blue/green' };
		expect([containerLabel(titled, false), containerDetail(titled)]).toEqual(['Scout gateway', 'scout-gateway-1 · Switches blue/green']);
		// Workers share the API image's declared 8787, but nothing listens there.
		expect(formatPorts(by['scout-blue-worker-1']!)).toEqual({ labels: [], declared: false });
		expect(formatPorts(by['scout-blue-api-1']!)).toEqual({ labels: [':8787'], declared: false });
		expect(by['scout-gateway-1']!.proxy!.servers[0]!.locations.map(location => [location.path, location.targets])).toEqual([
			['/assets/', ['scout-blue-web-1']],
			['@previous_assets', ['scout-green-web-1']],
		]);

		const scout = apps.find(app => app.id === 'scout')!;
		expect(scout.projects).toEqual(['scout', 'scout-blue', 'scout-green']);
		expect(scout.routing).toEqual(['scout-gateway-1']);
		expect(scout.databases).toEqual(['scout-db-1']);
		expect(scout.slots.map(slot => [slot.label, slot.state])).toEqual([['blue', 'live'], ['green', 'standby']]);
	});

	it('follows tunnel ingress by hostname and starts traffic there', () => {
		const input = scoutFixture();
		input.ps.push({ id: 't', name: 'edge-cloudflared-1', image: 'cloudflare/cloudflared', command: 'cloudflared tunnel run', state: 'running', status: 'Up', project: 'edge', service: 'cloudflared', replica: 1, workingDir: null, networks: ['edge'], ports: [] });
		input.ps.push({ id: 'o', name: 'old-app-1', image: 'node', command: 'node server/index.ts', state: 'running', status: 'Up', project: 'old', service: 'app', replica: 1, workingDir: null, networks: ['edge'], ports: [] });
		input.tunnelLogs = new Map([['edge-cloudflared-1', { id: null, version: null, metricsPort: null, configVersion: 6, configAt: null, reconnects: 200, ingress: [{ hostname: 'growthscout.io', service: 'http://growthscout:80' }, { hostname: 'gone.example', service: 'http://missing:80' }, { hostname: null, service: 'http_status:404' }] }]]);
		input.tunnelMetrics = new Map([['edge-cloudflared-1', { metrics: { connections: 3, requests: 100, errors: 0, concurrent: 0, responses: { '2xx': 100, '3xx': 0, '4xx': 0, '5xx': 0 } }, requestRate: 1.25, errorRate: 0 }]]);
		const { containers, apps } = buildTopology(input);
		const by = Object.fromEntries(containers.map(container => [container.name, container]));
		expect(by['scout-gateway-1']).toMatchObject({ traffic: 'live', routesIn: [{ from: 'edge-cloudflared-1', upstream: 'growthscout.io', role: 'direct' }] });
		// On the public network but not in any ingress rule: not live once ingress is known.
		expect(by['old-app-1']!.traffic).toBe('internal');
		expect(by['edge-cloudflared-1']!.tunnel!.ingress!.map(rule => rule.targets)).toEqual([['scout-gateway-1'], [], []]);
		expect(requestSummary(by['edge-cloudflared-1']!)).toBe('1.3 req/s');
		const host = { id: 'm', name: 'm', target: '', status: 'online' as const, error: null, sampledAt: 0, latencyMs: 0, engine: null, kubernetes: null, disks: null, containers, apps, activity: [] };
		expect(hostWarnings(host).filter(warning => warning.container === 'edge-cloudflared-1').map(warning => warning.message)).toEqual([
			'has 3 of 4 edge connections',
			're-registered edge connections 200 times in 24 hours',
			'routes gone.example to http://missing:80, which no running container answers',
		]);
	});

	it('warns about a standby slot that could not take traffic back, and confirms risky actions', () => {
		const { containers, apps } = buildTopology(scoutFixture());
		const host = { id: 'm', name: 'mac-server', target: '', status: 'online' as const, error: null, sampledAt: 0, latencyMs: 0, engine: null, kubernetes: null, disks: null, containers, apps, activity: [] };
		expect(hostWarnings(host).map(warning => warning.container)).toEqual(['scout-green-api-1']);
		const api = containers.find(container => container.name === 'scout-blue-api-1')!;
		expect(confirmAction(api, 'start', 'mac-server')).toBeNull();
		expect(confirmAction(api, 'stop', 'mac-server')).toMatch(/serving live traffic[\s\S]*deploy script/);
	});
});

describe('hosts', () => {
	it('saves hosts and rejects SSH destinations that could be options', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dock-hosts-'));
		try {
			const store = new HostStore(join(dir, 'hosts.json'));
			await store.load();
			expect(await store.add({ name: '', ssh: 'steve@mac-server' })).toEqual({ id: 'mac-server', name: 'mac-server', ssh: 'steve@mac-server' });
			expect((await store.add({ name: 'Mac server' })).id).toBe('mac-server-2');
			await expect(store.add({ name: 'x', ssh: '-oProxyCommand=evil' })).rejects.toThrow(/SSH destination/);
			const reloaded = new HostStore(join(dir, 'hosts.json'));
			await reloaded.load();
			expect(reloaded.list().map(host => host.id)).toEqual(['mac-server', 'mac-server-2']);
			expect(() => new RemoteShell({ ssh: '-oProxyCommand=evil' })).toThrow();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('samples through its shell and only acts on known container names', async () => {
		const scripts: string[] = [];
		const ps = { ID: 'a1', Names: 'app-web-1', Image: 'nginx', Command: '"nginx"', State: 'running', Status: 'Up 1 hour', Labels: 'com.docker.compose.project=app,com.docker.compose.service=web', Networks: 'edge', Ports: '80/tcp' };
		const shell = {
			target: 'fake',
			run: async (script: string) => {
				scripts.push(script);
				return `@@ps\n${JSON.stringify(ps)}\n@@stats\n@@inspect\n@@disk-host\n/dev/sda1 100 40 60 40% /\n@@disk app-web-1\n${NO_MOUNTS}\n`;
			},
			stream: () => {
				throw new Error('not used');
			},
		};
		const published: string[] = [];
		const watcher = new HostWatcher({ id: 'h', name: 'h' }, { fastEveryMs: 1e9, slowEveryMs: 1e9, shell: () => shell as never }, snapshot => published.push(snapshot.status));
		await watcher.sample();
		expect(watcher.snapshot()).toMatchObject({ status: 'online', containers: [{ name: 'app-web-1', traffic: 'live', role: 'web' }] });
		expect(scripts[0]).toContain('@@inspect');
		expect(watcher.snapshot().disks).toEqual([{ filesystem: '/dev/sda1', paths: ['/'], size: 102400, used: 40960, free: 61440 }]);
		expect(watcher.snapshot().containers[0]!.disks).toEqual([]);
		expect(watcher.snapshot().containers[0]!.history).toEqual({ cpu: [null], memory: [null] });
		await watcher.sample();
		expect(watcher.snapshot().containers[0]!.history.cpu).toHaveLength(2);
		await expect(watcher.action('app-web-1; rm -rf /', 'stop')).rejects.toThrow(/No container/);
		await expect(watcher.action('other', 'stop')).rejects.toThrow(/No container/);
		await watcher.action('app-web-1', 'restart');
		expect(scripts).toContain('docker restart app-web-1');
		expect(published[0]).toBe('online');
		watcher.stop();
	});
});

describe('k3s', () => {
	const lines = (value: unknown) => JSON.stringify(value, null, 2).split('\n');

	it('reads Kubernetes quantities', () => {
		expect(cpuQuantity('12500000n')).toBe(1.3);
		expect(cpuQuantity('250m')).toBe(25);
		expect(cpuQuantity('2')).toBe(200);
		expect(memoryQuantity('512Mi')).toBe(512 * 1024 ** 2);
		expect(memoryQuantity('1G')).toBe(1e9);
		expect(memoryQuantity('oops')).toBeNull();
	});

	it('turns pods into container rows with usage, skipping finished pods and unsafe names', () => {
		const sample = parseKubePods(lines(KUBE_PODS), lines(KUBE_METRICS));
		expect(sample.ps.map(row => [row.name, row.state, row.project, row.service])).toEqual([
			['starter-production/web-7d9c6b5f4-x2x8q', 'running', 'starter-production', 'web'],
			['starter-production/queue-6f8d7c9b8-kq2lp', 'restarting', 'starter-production', 'queue'],
			['kube-system/coredns-ccb96694c-9xk4m/coredns', 'running', 'kube-system', 'kube-dns'],
			['kube-system/coredns-ccb96694c-9xk4m/sidecar', 'running', 'kube-system', 'kube-dns'],
		]);
		expect(sample.stats.get('starter-production/web-7d9c6b5f4-x2x8q')).toMatchObject({ cpu: 1.3, memory: 190 * 1024 ** 2, memoryLimit: 512 * 1024 ** 2 });
		expect(sample.inspect.get('starter-production/queue-6f8d7c9b8-kq2lp')).toMatchObject({ restartCount: 7, exitCode: 1, health: null });
		expect(sample.targets.get('kube-system/coredns-ccb96694c-9xk4m/sidecar')).toEqual({ namespace: 'kube-system', pod: 'coredns-ccb96694c-9xk4m', container: 'sidecar' });
		expect(parseKubeNodes(lines(KUBE_NODES))).toEqual({ version: 'v1.33.5+k3s1', os: 'Ubuntu 24.04.3 LTS', nodes: 1, cpus: 4, memory: 8130084 * 1024 });
		expect(parseKubePods(['not json'], undefined).ps).toEqual([]);
	});

	it('samples a k3s machine without Docker through a real shell', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'dock-k3s-'));
		try {
			await writeFile(join(dir, 'pods.json'), JSON.stringify(KUBE_PODS));
			await writeFile(join(dir, 'metrics.json'), JSON.stringify(KUBE_METRICS));
			await writeFile(join(dir, 'nodes.json'), JSON.stringify(KUBE_NODES));
			await writeFile(join(dir, 'k3s'), [
				'#!/bin/sh',
				`D='${dir}'`,
				'case "$*" in',
				'\t*"get --raw /version"*) echo "{}" ;;',
				'\t*"get pods -A -o json"*) cat "$D/pods.json" ;;',
				'\t*metrics.k8s.io*) cat "$D/metrics.json" ;;',
				'\t*"get nodes -o json"*) cat "$D/nodes.json" ;;',
				'\t*"delete pod"*) echo "$*" >> "$D/calls" ;;',
				'\t*) exit 1 ;;',
				'esac',
			].join('\n'));
			await chmod(join(dir, 'k3s'), 0o755);
			const real = new RemoteShell({});
			// No Docker on this machine: only the fake k3s answers.
			const prefix = `docker() { return 127; }\nexport PATH="${dir}:$PATH"\n`;
			const shell = { target: real.target, run: (script: string, ms?: number) => real.run(prefix + script, ms), stream: (script: string) => real.stream(prefix + script) };
			const watcher = new HostWatcher({ id: 'worker', name: 'worker' }, { fastEveryMs: 1e9, slowEveryMs: 1e9, shell: () => shell as never }, () => undefined);
			await watcher.sample();
			const snapshot = watcher.snapshot();
			expect(snapshot).toMatchObject({ status: 'online', kubernetes: { version: 'v1.33.5+k3s1', nodes: 1, cpus: 4, error: null } });
			const web = snapshot.containers.find(container => container.name === 'starter-production/web-7d9c6b5f4-x2x8q')!;
			expect(web).toMatchObject({ runtime: 'kubernetes', role: 'web', state: 'running', cpu: 1.3, title: 'web', history: { cpu: [1.3] } });
			expect(snapshot.containers.filter(container => container.runtime === 'kubernetes')).toHaveLength(4);
			await expect(watcher.action(web.name, 'stop')).rejects.toThrow(/Kubernetes/);
			await watcher.action(web.name, 'restart');
			expect(await readFile(join(dir, 'calls'), 'utf8')).toContain('delete pod -n starter-production web-7d9c6b5f4-x2x8q --wait=false');
			watcher.stop();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('explains how to give access when the cluster cannot be read', async () => {
		const shell = { target: 'fake', run: async () => '@@k8s-denied\n@@ps\n', stream: () => { throw new Error('not used'); } };
		const watcher = new HostWatcher({ id: 'w', name: 'w' }, { fastEveryMs: 1e9, slowEveryMs: 1e9, shell: () => shell as never }, () => undefined);
		await watcher.sample();
		expect(watcher.snapshot().kubernetes?.error).toMatch(/~\/\.kube\/config/);
		watcher.stop();
	});
});
