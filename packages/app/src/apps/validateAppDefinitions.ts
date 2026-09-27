import type * as apps from './contracts';
import { normalizeAppNavigation } from './normalizeAppNavigation';
import { isQueueableJobClass, queueableJobName } from '../queue';

/** Validates names, contribution ownership and dependency order before any app code is started. */
export function validateAppDefinitions(definitions: apps.AppDefinitions, reserved: readonly string[]): string[] {
	const ids = Object.keys(definitions);
	const tables = new Set<string>();
	for (const id of ids) {
		const definition = definitions[id];
		const manifest = definition.manifest;
		if (!/^[a-z][a-z0-9_]{0,39}$/.test(id) || /^db3(?:_|$)/.test(id) || reserved.includes(id) || manifest.id !== id) throw new Error(`Invalid or reserved app identifier "${id}".`);
		if (!manifest.name?.trim() || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !Number.isSafeInteger(manifest.apiVersion ?? 1) || (manifest.apiVersion ?? 1) < 1) throw new Error(`Invalid app manifest for "${id}"; use a stable x.y.z release and a positive API generation.`);
		if (typeof definition.create !== 'function') throw new Error(`App "${id}" must create a public service.`);
		const jobs = new Set<string>();
		for (const Job of definition.jobs ?? []) {
			if (!isQueueableJobClass(Job) || !Job.jobName?.startsWith(`${id}.`) || jobs.has(queueableJobName(Job))) throw new Error(`Invalid or duplicate job in "${id}"; declare a stable ${id}. jobName.`);
			jobs.add(queueableJobName(Job));
		}
		for (const Model of definition.database?.models ?? []) {
			if (!Model.table.startsWith(`${id}_`) || tables.has(Model.table)) throw new Error(`App "${id}" cannot own table "${Model.table}".`);
			tables.add(Model.table);
		}
		const paths = new Set<string>();
		for (const route of definition.routes ?? []) {
			const key = `${route.method} ${route.path}`;
			if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method) || !/^\/(?:[a-zA-Z0-9_:-]+(?:\/[a-zA-Z0-9_:-]+)*)?$/.test(route.path) || paths.has(key) || typeof route.handle !== 'function') throw new Error(`Invalid or duplicate route "${key}" in "${id}".`);
			paths.add(key);
		}
		try { normalizeAppNavigation({ items: manifest.navigation ?? [] }); }
		catch { throw new Error(`Invalid navigation in "${id}".`); }
		for (const [dependency, generation] of Object.entries({ ...manifest.requires, ...manifest.optional })) {
			if (!/^[a-z][a-z0-9_]{0,39}$/.test(dependency) || reserved.includes(dependency) || dependency === id || !Number.isSafeInteger(generation) || generation < 1) throw new Error(`Invalid dependency "${dependency}" in "${id}".`);
			if (manifest.requires?.[dependency] !== undefined && manifest.optional?.[dependency] !== undefined) throw new Error(`Dependency "${dependency}" is both required and optional in "${id}".`);
		}
	}
	const visiting = new Set<string>();
	const ordered = new Set<string>();
	/** Topologically orders available dependencies and rejects composition cycles. */
	function visit(id: string): void {
		if (ordered.has(id)) return;
		if (visiting.has(id)) throw new Error(`App dependency cycle at "${id}".`);
		visiting.add(id);
		for (const dependency of Object.keys({ ...definitions[id].manifest.requires, ...definitions[id].manifest.optional })) {
			if (definitions[dependency]) visit(dependency);
		}
		visiting.delete(id);
		ordered.add(id);
	}
	ids.forEach(visit);
	return [...ordered];
}
