import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CreateAppDatabase } from '../../shared/contracts.js';
import { DockRequestError } from './ProjectStore.js';

/** Same rule `create-db3` applies to the folder name. */
const APP_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Finds the `create-db3` executable: the workspace's `@db3.ai/create`, else
 * the framework source next to Dock.
 *
 * @returns Absolute path to `bin/create.mjs`.
 */
export function findCreator(): string {
	try {
		return createRequire(import.meta.url).resolve('@db3.ai/create/bin/create.mjs');
	} catch {
		const source = fileURLToPath(new URL('../../../../packages/create/bin/create.mjs', import.meta.url));
		if (existsSync(source)) return source;
		throw new DockRequestError('Dock could not find create-db3 (@db3.ai/create) in this workspace.', 500);
	}
}

/**
 * Generates a new db3 app with `create-db3 --no-install`, leaving install and
 * migrations to a setup terminal so their output and prompts stay visible.
 *
 * @param name - New folder name.
 * @param folder - Existing parent folder; `~` is expanded.
 * @param database - `docker` writes a `.env` for the bundled MariaDB container.
 * @param creator - `create-db3` script; replaceable in tests.
 * @returns Absolute path of the new app.
 */
export async function generateApp(name: string, folder: string, database: CreateAppDatabase, creator = findCreator()): Promise<string> {
	const appName = String(name ?? '').trim();
	if (!APP_NAME.test(appName)) throw new DockRequestError('Use an app name starting with a lowercase letter, containing lowercase letters, numbers or hyphens.');
	const parent = resolve(expandHome(String(folder ?? '').trim() || '.'));
	try {
		if (!(await stat(parent)).isDirectory()) throw new Error();
	} catch {
		throw new DockRequestError(`"${folder}" is not a folder.`);
	}
	const target = join(parent, appName);
	if (existsSync(target)) throw new DockRequestError(`"${target}" already exists. Choose another name or folder.`);
	const args = [creator, appName, '--no-install', ...(database === 'docker' ? ['--docker'] : [])];
	await new Promise<void>((done, fail) => {
		execFile(process.execPath, args, { cwd: parent, timeout: 60000 }, (error, _stdout, stderr) => {
			if (!error) return done();
			fail(new DockRequestError(`create-db3 failed: ${String(stderr).trim() || error.message}`));
		});
	});
	return target;
}

/**
 * Shell command for a new app's setup terminal. Local MariaDB waits for Enter
 * while the developer fills in `.env`, as `create-db3` does in a terminal.
 *
 * @param database - Where the database runs.
 * @returns Program and arguments.
 */
export function setupCommand(database: CreateAppDatabase): string[] {
	// npm 10 (Node 22) fails to install the starter, so say so plainly first.
	const node = `node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 24 ? 1 : 0)' || { printf '%s\\n' "db3 apps need Node 24 or newer; Dock's terminals run Node $(node -v). Start Dock from a Node 24 shell (nvm use 24), then restart setup."; exit 1; }`;
	const steps = database === 'docker'
		? ['docker compose up -d --wait db']
		: [
			`printf '%s\\n' 'Create a MariaDB database and user as README.md describes, then set the DB_ values in .env.'`,
			`printf 'Press Enter when your database configuration is ready. '`,
			'read _',
		];
	steps.push('npm install', 'npm run db:migrate', `printf '\\n%s\\n' 'Setup finished. Start dev to run the app.'`);
	return ['/bin/sh', '-c', [node, ...steps].join(' && ')];
}

function expandHome(path: string): string {
	if (path === '~' || path.startsWith('~/')) return `${process.env.HOME ?? ''}${path.slice(1)}`;
	return path;
}
