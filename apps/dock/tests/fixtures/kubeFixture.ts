/** `kubectl get pods -A -o json`, cut down from a k3s machine running the Starter. */
export const KUBE_PODS = {
	items: [
		{
			metadata: { name: 'web-7d9c6b5f4-x2x8q', namespace: 'starter-production', labels: { app: 'web', 'db3.ai/release': '12' } },
			spec: { restartPolicy: 'Always', containers: [{ name: 'web', image: '10.43.255.250:5000/starter:12', command: ['node'], args: ['/db3/start.mjs', 'web'], ports: [{ containerPort: 3000, protocol: 'TCP' }], resources: { limits: { memory: '512Mi' } } }] },
			status: { phase: 'Running', containerStatuses: [{ name: 'web', ready: true, restartCount: 1, image: '10.43.255.250:5000/starter:12', containerID: 'containerd://abc', state: { running: { startedAt: '2026-10-27T10:00:00Z' } } }] },
		},
		{
			metadata: { name: 'queue-6f8d7c9b8-kq2lp', namespace: 'starter-production', labels: { app: 'queue' } },
			spec: { restartPolicy: 'Always', containers: [{ name: 'queue', image: 'starter:12' }] },
			status: { phase: 'Running', containerStatuses: [{ name: 'queue', ready: false, restartCount: 7, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { exitCode: 1, finishedAt: '2026-10-27T10:05:00Z' } } }] },
		},
		{
			metadata: { name: 'migrate-12-abcde', namespace: 'starter-production', labels: { 'job-name': 'migrate-12' } },
			spec: { containers: [{ name: 'migrate', image: 'starter:12' }] },
			status: { phase: 'Succeeded' },
		},
		{
			metadata: { name: 'coredns-ccb96694c-9xk4m', namespace: 'kube-system', labels: { 'k8s-app': 'kube-dns' } },
			spec: { containers: [{ name: 'coredns', image: 'rancher/mirrored-coredns-coredns:1.12.0' }, { name: 'sidecar', image: 'busybox' }] },
			status: { phase: 'Running', containerStatuses: [{ name: 'coredns', ready: true, state: { running: { startedAt: '2026-10-26T09:00:00Z' } } }, { name: 'sidecar', ready: true, state: { running: {} } }] },
		},
		{ metadata: { name: 'Bad Name; rm -rf /', namespace: 'default' }, spec: { containers: [{ name: 'x', image: 'x' }] }, status: { phase: 'Running' } },
	],
};

/** `kubectl get --raw /apis/metrics.k8s.io/v1beta1/pods`. */
export const KUBE_METRICS = {
	items: [
		{ metadata: { name: 'web-7d9c6b5f4-x2x8q', namespace: 'starter-production' }, containers: [{ name: 'web', usage: { cpu: '12500000n', memory: '190Mi' } }] },
		{ metadata: { name: 'coredns-ccb96694c-9xk4m', namespace: 'kube-system' }, containers: [{ name: 'coredns', usage: { cpu: '3m', memory: '20480Ki' } }] },
	],
};

/** `kubectl get nodes -o json`. */
export const KUBE_NODES = {
	items: [{ status: { nodeInfo: { kubeletVersion: 'v1.33.5+k3s1', osImage: 'Ubuntu 24.04.3 LTS' }, capacity: { cpu: '4', memory: '8130084Ki' } } }],
};
