/**
 * Opens the Electron shell onto the Vite dev UI once the Dock server and Vite
 * are both answering. Run by `npm run dev:electron` alongside them; when the
 * window quits this exits, and `concurrently --kill-others` stops the rest.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dockDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = join(dockDir, 'electron');
const apiPort = process.env.DOCK_PORT || '8790';
const clientPort = process.env.DOCK_CLIENT_PORT || '5179';
const uiUrl = `http://127.0.0.1:${clientPort}`;
const timeoutMs = 60_000;

if (!existsSync(join(electronDir, 'node_modules', 'electron', 'dist'))) {
	console.error(`The Electron shell is not installed. Run once:\n  cd ${electronDir} && npm install --workspaces=false`);
	process.exit(1);
}

await waitFor([`http://127.0.0.1:${apiPort}/api/health`, `${uiUrl}/`]);
await run('npm', ['run', 'build'], electronDir);
const launchedAt = Date.now();
const code = await run(join(electronDir, 'node_modules', '.bin', 'electron'), ['.'], electronDir, {
	DOCK_PORT: apiPort,
	DOCK_UI_URL: uiUrl,
	DOCK_ELECTRON_PROFILE: 'db3-dock-electron-dev',
});
// An immediate clean exit means a dev window was already open and was brought forward instead.
if (code === 0 && Date.now() - launchedAt < 5000) {
	console.error('A Dock dev window is already open; it was brought to the front. Close it, then run this again.');
	process.exit(1);
}
process.exit(code);

/**
 * @param {string[]} urls - Addresses that must answer.
 */
async function waitFor(urls) {
	const startedAt = Date.now();
	console.log(`Waiting for Dock at ${urls.join(' and ')}.`);
	while (Date.now() - startedAt < timeoutMs) {
		const ready = await Promise.all(urls.map(answers));
		if (ready.every(Boolean)) return;
		await new Promise(resolve => setTimeout(resolve, 300));
	}
	console.error(`Dock did not start within ${timeoutMs / 1000}s.`);
	process.exit(1);
}

/**
 * @param {string} url - Address to probe.
 * @returns {Promise<boolean>} Whether it answered with a success status.
 */
async function answers(url) {
	try {
		return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
	} catch {
		return false;
	}
}

/**
 * @param {string} command - Executable.
 * @param {string[]} args - Arguments.
 * @param {string} cwd - Working directory.
 * @param {Record<string, string>} [env] - Extra environment.
 * @returns {Promise<number>} Exit code.
 */
function run(command, args, cwd, env = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
		child.once('error', reject);
		child.once('exit', code => {
			if (code !== 0 && command === 'npm') process.exit(code ?? 1);
			resolve(code ?? 0);
		});
	});
}
