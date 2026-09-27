import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DiscoveredApp } from './contracts';
import { validateAppDefinitions } from './validateAppDefinitions';

/** Discovers local apps and opted-in direct npm dependencies without executing their code. */
export function discoverApps(directory: string): DiscoveredApp[] {
	const found: DiscoveredApp[] = [];
	const root = join(directory, 'apps');
	if (existsSync(root)) {
		for (const item of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (item.isDirectory() && existsSync(join(root, item.name, 'manifest.json'))) found.push(readApp(join(root, item.name), item.name));
		}
	}
	const packageFile = join(directory, 'package.json');
	if (existsSync(packageFile)) {
		const host = JSON.parse(readFileSync(packageFile, 'utf8'));
		const require = createRequire(packageFile);
		for (const name of Object.keys({ ...host.dependencies, ...host.optionalDependencies }).sort()) {
			let file: string;
			try { file = require.resolve(`${name}/package.json`); }
			catch { continue; } // Packages must export package.json to opt into metadata-only discovery.
			const metadata = JSON.parse(readFileSync(file, 'utf8'));
			if (metadata.db3?.app !== true) continue;
			found.push(readApp(dirname(file), basename(name), name, metadata.db3));
		}
	}
	const definitions: Record<string, any> = Object.create(null);
	for (const app of found) {
		const id = app.manifest.id;
		if (Object.hasOwn(definitions, id)) throw new Error(`Duplicate app "${id}". Keep either the local folder or the npm package.`);
		definitions[id] = { manifest: app.manifest, create: () => undefined };
	}
	validateAppDefinitions(definitions, [...Object.getOwnPropertyNames(Object.prototype), 'then', 'toJSON']);
	return found;
}

/** Reads one conventional root manifest and resolves entries contained in that app's directory. */
function readApp(directory: string, id: string, packageName?: string, entries?: { entry?: string; client?: string }): DiscoveredApp {
	const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
	if (manifest.id !== undefined && manifest.id !== id) throw new Error(`App folder "${id}" disagrees with manifest identifier "${manifest.id}".`);
	const entry = containedEntry(directory, entries?.entry ?? 'App.ts');
	const clientPath = entries?.client ?? 'client/index.ts';
	const client = containedEntry(directory, clientPath);
	return { manifest: { ...manifest, id }, directory, entry, ...(existsSync(client) ? { client } : {}), ...(packageName ? { packageName } : {}) };
}

/** Rejects entry paths that escape the package or local app root. */
function containedEntry(directory: string, entry: string): string {
	if (typeof entry !== 'string' || isAbsolute(entry)) throw new Error('App entries must be relative paths.');
	const target = resolve(directory, entry);
	const path = relative(directory, target);
	if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('App entries must remain inside their app directory.');
	return target;
}
