import { buildTopology } from '../../server/hosts/buildTopology.js';
import type { InspectRow, PsRow } from '../../server/hosts/parseDocker.js';
import { parseNginxRoutes } from '../../server/hosts/parseNginxRoutes.js';

/** A cut-down copy of the production Scout layout: gateway, two slots, database. */
export function scoutFixture(): Parameters<typeof buildTopology>[0] {
	const ps: PsRow[] = [];
	const inspect = new Map<string, InspectRow>();
	const add = (name: string, project: string, service: string, command: string, networks: Record<string, string[]>, state = 'running', image = 'sha256:abc') => {
		const workingDir = project === 'scout-blue' ? '/srv/scout/releases/20261011103850-63baa13cb03c-01868/platform/apps/scout' : null;
		ps.push({ id: name, name, image, command, state, status: state === 'running' ? 'Up 2 days' : 'Exited (0) 2 days ago', project, service, replica: 1, workingDir, networks: Object.keys(networks), ports: [] });
		inspect.set(name, {
			id: name, name, cmd: command.split(' '), entrypoint: [], image, labels: {},
			networks: Object.entries(networks).map(([network, aliases]) => ({ name: network, aliases: [name, service, ...aliases] })),
			health: null, healthOutput: null, startedAt: null, finishedAt: null, exitCode: state === 'running' ? null : 0, restartCount: 0, restartPolicy: 'unless-stopped',
		});
	};
	add('scout-gateway-1', 'scout', 'gateway', 'nginx -g daemon off;', { edge: ['growthscout'], 'scout-releases': ['scout-gateway'] });
	add('scout-db-1', 'scout', 'db', 'docker-entrypoint.sh mariadbd', { scout_default: [] }, 'running', 'mariadb:12.3');
	for (const slot of ['blue', 'green']) {
		const running = slot === 'blue' ? 'running' : 'exited';
		add(`scout-${slot}-web-1`, `scout-${slot}`, 'web', 'nginx -g daemon off;', { [`scout-${slot}_default`]: [], 'scout-releases': [`scout-${slot}`] });
		add(`scout-${slot}-api-1`, `scout-${slot}`, 'api', 'node --import tsx server/index.ts', { [`scout-${slot}_default`]: ['scout-slot-api'], 'scout-releases': [], scout_default: [] }, running);
		add(`scout-${slot}-worker-1`, `scout-${slot}`, 'worker', 'sh -c exec node --import tsx server/console.ts queue:work --pool=shared', { [`scout-${slot}_default`]: [], scout_default: [] }, running);
	}
	return {
		ps,
		inspect,
		stats: new Map([['scout-blue-worker-1', { name: 'scout-blue-worker-1', cpu: 2.5, memory: 5e8, memoryLimit: 1e10, pids: 12, rx: 0, tx: 0 }]]),
		routes: new Map([
			['scout-gateway-1', parseNginxRoutes('upstream scout_active { server scout-blue:80; }\nupstream scout_previous { server scout-green:80; }\nserver { listen 80; location /assets/ { proxy_pass http://scout_active; error_page 404 = @previous_assets; } location @previous_assets { proxy_pass http://scout_previous; } }')],
			['scout-blue-web-1', parseNginxRoutes('proxy_pass http://scout-slot-api:8787;')],
			['scout-green-web-1', parseNginxRoutes('proxy_pass http://scout-slot-api:8787;')],
		]),
		listening: new Map([
			['scout-blue-api-1', [{ port: 8787, loopback: false }]],
			['scout-blue-worker-1', []],
		]),
		host: {},
	};
}
