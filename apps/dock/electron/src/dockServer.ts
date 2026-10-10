import { spawn, type ChildProcess } from 'node:child_process';

/** A Dock server the shell is using: started by it, or already running. */
export interface DockServerHandle {
	url: string;
	/** Stops the server if this shell started it; supervised processes stop with it. */
	stop(): Promise<void>;
}

/** Where and how to run the Dock server. */
export interface DockServerOptions {
	/** The `apps/dock` folder. */
	dockDir: string;
	port: number;
	/** Milliseconds to wait for `/api/health`. */
	timeoutMs?: number;
}

/**
 * Uses a Dock server already listening on the port, or starts one with
 * `node --import tsx server/index.ts` and waits until it is healthy.
 *
 * @param options - Folder, port and timeout.
 * @returns The server URL and a stop function.
 * @throws When the server does not become healthy in time.
 */
export async function ensureDockServer(options: DockServerOptions): Promise<DockServerHandle> {
	const url = `http://127.0.0.1:${options.port}`;
	if (await isHealthy(url)) return { url, stop: async () => {} };

	// System Node from PATH: inside Electron, process.execPath is the Electron binary.
	const child = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
		cwd: options.dockDir,
		env: { ...process.env, DOCK_PORT: String(options.port), DOCK_HOST: '127.0.0.1' },
		stdio: ['ignore', 'inherit', 'inherit'],
	});
	const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));

	const deadline = Date.now() + (options.timeoutMs ?? 20000);
	while (!(await isHealthy(url))) {
		if (child.exitCode !== null) throw new Error(`Dock server exited with code ${child.exitCode}.`);
		if (Date.now() > deadline) {
			child.kill('SIGTERM');
			throw new Error('Dock server did not start in time.');
		}
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	return { url, stop: () => stopChild(child, exited) };
}

async function isHealthy(url: string): Promise<boolean> {
	try {
		const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
		const body = await response.json() as { app?: string };
		return response.ok && body.app === 'db3-dock';
	} catch {
		return false;
	}
}

async function stopChild(child: ChildProcess, exited: Promise<void>): Promise<void> {
	if (child.exitCode !== null) return;
	child.kill('SIGTERM');
	const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
	await exited;
	clearTimeout(timer);
}
