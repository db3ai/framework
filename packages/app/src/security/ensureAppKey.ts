import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { Security } from './Security';
import { SecurityError } from './SecurityError';

/**
 * Returns the conventional `APP_KEY`, generating it in `.env` when missing.
 *
 * Applications should normally call this from their security config after
 * checking the environment. Existing non-empty values are preserved so invalid
 * keys fail normal security validation instead of being silently replaced.
 *
 * @returns Existing or newly generated application key.
 * @throws {SecurityError} When `.env` cannot be read or updated.
 *
 * @example
 * export default defineConfig({
 * 	key: env.string('APP_KEY') || ensureAppKey(),
 * });
 */
export function ensureAppKey(): string {
	const environmentKey = process.env.APP_KEY?.trim();

	if (environmentKey) return environmentKey;

	const environmentFile = resolve(process.cwd(), '.env');

	try {
		let content = '';

		try {
			content = readFileSync(environmentFile, 'utf8');
		} catch (error) {
			if (
				typeof error !== 'object'
				|| error === null
				|| !('code' in error)
				|| error.code !== 'ENOENT'
			) {
				throw error;
			}
		}

		const fileKey = parse(content).APP_KEY?.trim();

		if (fileKey) {
			process.env.APP_KEY = fileKey;
			return fileKey;
		}

		const generatedKey = Security.generateKey();
		const keyLine = `APP_KEY=${generatedKey}`;
		const existingKeyLine = /^(?:export\s+)?APP_KEY\s*=.*$/m;
		let updatedContent: string;

		if (existingKeyLine.test(content)) {
			updatedContent = content.replace(existingKeyLine, keyLine);
		} else {
			const separator = content.length > 0 && !content.endsWith('\n')
				? '\n'
				: '';

			updatedContent = `${content}${separator}${keyLine}\n`;
		}

		writeFileSync(environmentFile, updatedContent, {
			encoding: 'utf8',
			mode: 0o600,
		});
		process.env.APP_KEY = generatedKey;

		return generatedKey;
	} catch (error) {
		if (error instanceof SecurityError) throw error;

		throw new SecurityError(
			'Application security could not persist APP_KEY to ".env".',
			{ cause: error },
		);
	}
}
