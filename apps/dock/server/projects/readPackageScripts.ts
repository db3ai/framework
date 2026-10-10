import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PackageScript } from '../../shared/contracts.js';
import { processKind } from '../../shared/processKind.js';

/** Fields Dock reads from a project's package.json. */
export interface PackageInfo {
	name: string | null;
	scripts: PackageScript[];
}

/**
 * Reads the npm scripts from a project folder.
 *
 * @param projectPath - Folder containing package.json.
 * @returns Package name and classified scripts in file order.
 * @throws When package.json is missing or not valid JSON.
 */
export async function readPackageScripts(projectPath: string): Promise<PackageInfo> {
	const raw = await readFile(join(projectPath, 'package.json'), 'utf8');
	const json = JSON.parse(raw) as { name?: unknown; scripts?: Record<string, unknown> };
	const scripts = Object.entries(json.scripts ?? {})
		.filter((entry): entry is [string, string] => typeof entry[1] === 'string')
		.map(([name, body]) => ({ name, body, kind: processKind(name, body) }));
	return { name: typeof json.name === 'string' ? json.name : null, scripts };
}
