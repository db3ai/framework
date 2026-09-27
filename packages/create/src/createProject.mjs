import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStarterFiles } from './starterFiles.mjs';

/**
 * Creates a new starter without overwriting an existing path or inheriting secrets.
 *
 * @param {string} destination - New project directory, relative to the caller.
 * @param {{ docker?: boolean }} options - Whether to configure the bundled local database.
 * @returns {Promise<string>} Absolute project directory.
 */
export async function createProject(destination, options = {}) {
	const target = resolve(destination);
	const name = basename(target);
	if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Use a project name starting with a lowercase letter, containing lowercase letters, numbers or hyphens.');
	const bundled = new URL('../template/', import.meta.url);
	const template = fileURLToPath(existsSync(new URL('package.json', bundled)) ? bundled : new URL('../../../apps/starter/', import.meta.url));
	const files = await listStarterFiles(template);
	// Exclusive mkdir rejects existing files, directories and symlinks, even empty ones.
	await mkdir(target);
	for (const file of files) {
		await mkdir(dirname(join(target, file)), { recursive: true });
		await cp(join(template, file), join(target, file), { force: false, errorOnExist: true });
	}
	const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
	manifest.name = name;
	await writeFile(join(target, 'package.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	const example = await readFile(join(target, '.env.example'), 'utf8');
	const environment = options.docker
		? example.replace('DB_PORT=3306', 'DB_PORT=33067').replace('DB_PASSWORD=\n', `DB_PASSWORD=${randomBytes(24).toString('hex')}\n`)
		: example;
	await writeFile(join(target, '.env'), environment, { flag: 'wx', mode: 0o600 });
	await writeFile(join(target, '.gitignore'), 'node_modules/\ndist/\n.env\n.env.*\n!.env.example\ncoverage/\nstorage/\n');
	return target;
}
