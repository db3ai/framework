import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { APP_PROFILE_FILE, AppProfileError, parseAppProfile, type AppProfile } from '../../shared/appProfile.js';

/**
 * Reads a project's `db3.app.json`, if it has one.
 *
 * @param projectPath - Project root folder.
 * @returns The profile, or null when the folder has none.
 * @throws AppProfileError when the file exists but is not a valid profile.
 */
export async function readAppProfile(projectPath: string): Promise<AppProfile | null> {
	let raw: string;
	try {
		raw = await readFile(join(projectPath, APP_PROFILE_FILE), 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		throw new AppProfileError('not valid JSON.');
	}
	return parseAppProfile(json);
}
