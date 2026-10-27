import type { InspectRow, PsRow, StatsRow } from './parseDocker.js';

/**
 * Finds a working `kubectl` on a k3s machine and sets `KC` to it: the user's own
 * kubeconfig first, then k3s's (readable when installed with
 * `--write-kubeconfig-mode 644`), then `sudo -n` when sudo needs no password.
 * Prints `@@k8s-denied` when k3s is there but none of them can read the cluster.
 * Machines without k3s are left alone, so a laptop's kubectl context is never read.
 */
export const KUBE_PRELUDE = [
	'KC=',
	'if command -v k3s >/dev/null 2>&1; then',
	'\t[ -r "$HOME/.kube/config" ] && export KUBECONFIG="$HOME/.kube/config"',
	'\tif k3s kubectl --request-timeout=3s get --raw /version >/dev/null 2>&1; then KC="k3s kubectl"',
	'\telif sudo -n k3s kubectl --request-timeout=3s get --raw /version >/dev/null 2>&1; then KC="sudo -n k3s kubectl"',
	'\telse KC=denied; fi',
	'fi',
].join('\n');

/** How a container row maps back to its pod, for logs and actions. */
export interface KubeTarget {
	namespace: string;
	pod: string;
	container: string;
}

/** Containers from a cluster, in the shapes the Docker sampler produces. */
export interface KubeSample {
	ps: PsRow[];
	inspect: Map<string, InspectRow>;
	stats: Map<string, StatsRow>;
	targets: Map<string, KubeTarget>;
}

/** Cluster facts for the machine header. */
export interface KubeNodes {
	version: string;
	os: string;
	nodes: number;
	cpus: number;
	memory: number;
}

/** Kubernetes object names (lowercase DNS labels and subdomains), safe to pass to a shell. */
const KUBE_NAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

const BINARY: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, k: 1e3, M: 1e6, G: 1e9, T: 1e12 };

/**
 * @param value - Kubernetes CPU quantity such as `2`, `250m` or `123456n`.
 * @returns CPU percentage (100 = one core), or null.
 */
export function cpuQuantity(value: string | undefined): number | null {
	const match = value ? /^(\d+(?:\.\d+)?)([num]?)$/.exec(value) : null;
	if (!match) return null;
	const cores = Number(match[1]) / ({ n: 1e9, u: 1e6, m: 1e3, '': 1 } as Record<string, number>)[match[2]!]!;
	return Math.round(cores * 1000) / 10;
}

/**
 * @param value - Kubernetes memory quantity such as `10157432Ki` or `512Mi`.
 * @returns Bytes, or null.
 */
export function memoryQuantity(value: string | undefined): number | null {
	const match = value ? /^(\d+(?:\.\d+)?)([A-Za-z]*)$/.exec(value) : null;
	if (!match) return null;
	const unit = match[2] ? BINARY[match[2]] : 1;
	return unit ? Math.round(Number(match[1]) * unit) : null;
}

function parseJoined<T>(lines: string[] | undefined): T | null {
	if (!lines?.length) return null;
	try {
		return JSON.parse(lines.join('\n')) as T;
	} catch {
		return null;
	}
}

function time(value: unknown): number | null {
	const at = typeof value === 'string' ? Date.parse(value) : NaN;
	return Number.isFinite(at) ? at : null;
}

/**
 * Docker-style state for a container status: running, restarting (crash loop),
 * created (still being pulled or created) or exited.
 */
function stateOf(status: any): { state: string; status: string } {
	const [state, detail = {}] = (Object.entries(status?.state ?? {})[0] ?? ['waiting', { reason: 'Pending' }]) as [string, any];
	if (state === 'running') return { state: 'running', status: 'Running' };
	if (state === 'terminated') return { state: 'exited', status: `${detail.reason ?? 'Completed'} (${detail.exitCode ?? 0})` };
	const reason = String(detail.reason ?? 'Waiting');
	return { state: /BackOff|Error/.test(reason) ? 'restarting' : 'created', status: reason };
}

/**
 * Turns `kubectl get pods -A -o json` and pod metrics into container rows, so a
 * k3s machine shows its workloads the way a Docker one does: the namespace is
 * the project, the `app` label the service, and each pod's main containers are
 * rows named `namespace/pod` (with `/container` when a pod has several).
 * Finished pods (completed jobs) are left out.
 *
 * @param podLines - `@@k8s-pods` section.
 * @param metricLines - `@@k8s-metrics` section; usage is optional.
 * @returns Rows, details, usage and the pod behind each row.
 */
export function parseKubePods(podLines: string[] | undefined, metricLines: string[] | undefined): KubeSample {
	const sample: KubeSample = { ps: [], inspect: new Map(), stats: new Map(), targets: new Map() };
	const pods = parseJoined<{ items?: any[] }>(podLines)?.items ?? [];
	const metrics = parseJoined<{ items?: any[] }>(metricLines)?.items ?? [];
	const usage = new Map(metrics.map(item => [`${item.metadata?.namespace}/${item.metadata?.name}`, new Map<string, any>((item.containers ?? []).map((entry: any) => [entry.name, entry.usage ?? {}]))]));
	for (const pod of pods) {
		if (['Succeeded', 'Failed'].includes(pod.status?.phase)) continue;
		const namespace = String(pod.metadata?.namespace ?? 'default');
		const podName = String(pod.metadata?.name ?? '');
		if (!KUBE_NAME.test(namespace) || !KUBE_NAME.test(podName)) continue;
		const labels: Record<string, string> = pod.metadata?.labels ?? {};
		const specs: any[] = pod.spec?.containers ?? [];
		const statuses = new Map<string, any>((pod.status?.containerStatuses ?? []).map((status: any) => [status.name, status]));
		const service = labels.app ?? labels['app.kubernetes.io/name'] ?? labels['k8s-app'] ?? labels['job-name'] ?? null;
		const used = usage.get(`${namespace}/${podName}`);
		for (const spec of specs) {
			if (!KUBE_NAME.test(String(spec.name))) continue;
			const name = specs.length > 1 ? `${namespace}/${podName}/${spec.name}` : `${namespace}/${podName}`;
			const status = statuses.get(spec.name);
			const { state, status: text } = stateOf(status);
			const running = status?.state?.running;
			const terminated = status?.state?.terminated ?? status?.lastState?.terminated;
			const image = String(status?.image ?? spec.image ?? '');
			const command = [...(spec.command ?? []), ...(spec.args ?? [])].map(String);
			sample.targets.set(name, { namespace, pod: podName, container: spec.name });
			sample.ps.push({ id: status?.containerID ?? name, name, image, command: command.join(' '), state, status: text, project: namespace, service, replica: null, workingDir: null, networks: [], runtime: 'kubernetes', ports: (spec.ports ?? []).map((port: any) => ({ port: Number(port.containerPort), protocol: String(port.protocol ?? 'TCP').toLowerCase() })) });
			sample.inspect.set(name, {
				id: name,
				name,
				cmd: command,
				entrypoint: [],
				image,
				labels: { ...labels, 'dock.title': specs.length > 1 ? `${service ?? podName} · ${spec.name}` : service ?? podName, 'dock.description': `pod in ${namespace}` },
				networks: [],
				health: state === 'running' && !status?.ready ? 'starting' : null,
				healthOutput: null,
				startedAt: time(running?.startedAt),
				finishedAt: time(terminated?.finishedAt),
				exitCode: typeof terminated?.exitCode === 'number' ? terminated.exitCode : null,
				restartCount: status?.restartCount ?? 0,
				restartPolicy: String(pod.spec?.restartPolicy ?? ''),
			});
			const current = used?.get(spec.name);
			if (current) sample.stats.set(name, { name, cpu: cpuQuantity(current.cpu), memory: memoryQuantity(current.memory), memoryLimit: memoryQuantity(spec.resources?.limits?.memory), pids: null, rx: null, tx: null });
		}
	}
	return sample;
}

/**
 * @param lines - `@@k8s-nodes` section: `kubectl get nodes -o json`.
 * @returns Version, OS and summed capacity, or null.
 */
export function parseKubeNodes(lines: string[] | undefined): KubeNodes | null {
	const nodes = parseJoined<{ items?: any[] }>(lines)?.items ?? [];
	if (!nodes.length) return null;
	const info = nodes[0].status?.nodeInfo ?? {};
	return {
		version: String(info.kubeletVersion ?? ''),
		os: String(info.osImage ?? ''),
		nodes: nodes.length,
		cpus: nodes.reduce((total, node) => total + (Number(node.status?.capacity?.cpu) || 0), 0),
		memory: nodes.reduce((total, node) => total + (memoryQuantity(node.status?.capacity?.memory) ?? 0), 0),
	};
}
