#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const START_MARKER = '<!-- @db3.ai/app:start -->';
const END_MARKER = '<!-- @db3.ai/app:end -->';

const options = parseArguments(process.argv.slice(2));
const targetPath = resolve(process.cwd(), options.target);
const template = await readFile(
	new URL('../templates/AGENTS.md', import.meta.url),
	'utf8',
);
const existing = await readOptionalFile(targetPath);
const hasStartMarker = existing?.includes(START_MARKER) ?? false;
const hasEndMarker = existing?.includes(END_MARKER) ?? false;

if (hasStartMarker !== hasEndMarker) {
	throw new Error(
		`Refusing to update ${targetPath} because its @db3.ai/app markers are incomplete.`,
	);
}

if (options.check) {
	if (!hasStartMarker) {
		console.error(`${targetPath} does not contain the @db3.ai/app instruction scaffold.`);
		process.exitCode = 1;
	} else {
		console.log(`${targetPath} contains the @db3.ai/app instruction scaffold.`);
	}
} else if (hasStartMarker) {
	if (options.update) {
		const updated = replaceScaffold(existing ?? '', template);

		await writeFile(targetPath, updated, 'utf8');
		console.log(`Updated the @db3.ai/app instructions in ${targetPath}.`);
	} else {
		console.log(`${targetPath} already contains the @db3.ai/app instruction scaffold.`);
	}
} else {
	const updated = appendScaffold(existing, template);

	await writeFile(targetPath, updated, 'utf8');
	console.log(`Added the @db3.ai/app instruction scaffold to ${targetPath}.`);
}

/**
 * Parses supported command-line options for the scaffold command.
 *
 * @param {string[]} args - Command-line arguments after the executable name.
 * @returns {{ target: string, check: boolean, update: boolean }} Parsed options.
 */
function parseArguments(args) {
	const parsed = {
		target: 'AGENTS.md',
		check: false,
		update: false,
	};

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];

		if (argument === '--check') {
			parsed.check = true;
			continue;
		}

		if (argument === '--update') {
			parsed.update = true;
			continue;
		}

		if (argument === '--target') {
			const target = args[index + 1];

			if (!target) {
				throw new Error('--target requires a file path.');
			}

			parsed.target = target;
			index += 1;
			continue;
		}

		throw new Error(`Unknown db3-agents option "${argument}".`);
	}

	if (parsed.check && parsed.update) {
		throw new Error('--check and --update cannot be used together.');
	}

	return parsed;
}

/**
 * Reads an existing instruction file without failing when it is absent.
 *
 * @param {string} path - Absolute instruction-file path.
 * @returns {Promise<string | null>} Existing content or null when missing.
 */
async function readOptionalFile(path) {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return null;
		}

		throw error;
	}
}

/**
 * Appends the framework block without disturbing existing project guidance.
 *
 * @param {string | null} existing - Existing instruction content, when present.
 * @param {string} template - Current framework scaffold.
 * @returns {string} Complete instruction file content.
 */
function appendScaffold(existing, template) {
	const prefix = existing?.trimEnd();

	return prefix ? `${prefix}\n\n${template}` : template;
}

/**
 * Replaces only the marked framework block in an existing instruction file.
 *
 * @param {string} existing - Existing instruction content containing both markers.
 * @param {string} template - Current framework scaffold.
 * @returns {string} Updated instruction file content.
 */
function replaceScaffold(existing, template) {
	const start = existing.indexOf(START_MARKER);
	const end = existing.indexOf(END_MARKER, start);
	const suffixStart = end + END_MARKER.length;

	return `${existing.slice(0, start)}${template.trimEnd()}${existing.slice(suffixStart)}`;
}
