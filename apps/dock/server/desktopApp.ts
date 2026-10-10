import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Whether the optional Electron shell can be launched. */
export interface DesktopStatus {
	installed: boolean;
	/** Command that installs it, shown when it is not installed. */
	installCommand: string;
}

/**
 * @param dockDir - The `apps/dock` folder.
 * @returns Whether `electron/` has its dependencies and Electron binary.
 */
export function desktopStatus(dockDir: string): DesktopStatus {
	const electronDir = join(dockDir, 'electron');
	return {
		installed: existsSync(join(electronDir, 'node_modules', 'electron', 'dist')) && existsSync(join(electronDir, 'node_modules', '.bin', 'tsc')),
		installCommand: `cd ${electronDir} && npm install --workspaces=false`,
	};
}

/**
 * Compiles and launches the Electron shell, detached from this server.
 *
 * The shell attaches to this already-running server rather than starting its
 * own, and shows `uiUrl` (the page the user opened it from, such as the Vite
 * dev server). A second launch focuses the existing window.
 *
 * @param dockDir - The `apps/dock` folder.
 * @param options - Server port and the UI address to show.
 * @returns Resolves once the launch command has started.
 * @throws When the shell is not installed or cannot be started.
 */
export function openDesktop(dockDir: string, options: { port: number; uiUrl: string }): Promise<void> {
	if (!desktopStatus(dockDir).installed) return Promise.reject(new Error('The desktop app is not installed.'));
	return new Promise((resolve, reject) => {
		const child = spawn('sh', ['-c', 'npm run build && exec ./node_modules/.bin/electron .'], {
			cwd: join(dockDir, 'electron'),
			detached: true,
			stdio: 'ignore',
			env: { ...process.env, DOCK_PORT: String(options.port), DOCK_UI_URL: options.uiUrl },
		});
		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}
