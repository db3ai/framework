import { isAbsolute, resolve, sep } from 'node:path';
import { posix } from 'node:path';

/**
 * Normalizes a caller-provided storage path into a safe relative path.
 *
 * @param path - User or application supplied storage path.
 * @returns Normalized relative storage path using forward slashes.
 */
export function normalizeStoragePath(path: string): string {
	if (typeof path !== 'string') {
		throw new Error('Storage path must be a string.');
	}

	if (path.includes('\0')) {
		throw new Error('Storage path cannot contain null bytes.');
	}

	const input = path.trim().replace(/\\/g, '/');

	if (!input) {
		throw new Error('Storage path cannot be empty.');
	}

	if (input.startsWith('/') || isAbsolute(input)) {
		throw new Error(`Storage path "${path}" must be relative.`);
	}

	if (/^[A-Za-z]:\//.test(input)) {
		throw new Error(`Storage path "${path}" must be relative.`);
	}

	const normalized = posix.normalize(input);

	if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
		throw new Error(`Storage path "${path}" cannot leave the storage disk root.`);
	}

	return normalized;
}

/**
 * Normalizes a storage directory path while allowing the disk root.
 *
 * @param path - User or application supplied directory path.
 * @returns Normalized relative directory path, or an empty string for the root.
 */
export function normalizeStorageDirectoryPath(path = ''): string {
	if (typeof path !== 'string') {
		throw new Error('Storage path must be a string.');
	}

	const input = path.trim().replace(/\\/g, '/');

	if (input === '' || input === '.') return '';

	return normalizeStoragePath(input);
}

/**
 * Resolves a normalized storage path against a local disk root.
 *
 * @param root - Absolute or process-relative disk root.
 * @param path - Storage path to resolve.
 * @returns Absolute filesystem path inside the disk root.
 */
export function resolveLocalStoragePath(root: string, path: string): string {
	const normalizedRoot = resolve(root);
	const resolved = resolve(normalizedRoot, normalizeStoragePath(path));

	if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${sep}`)) {
		throw new Error(`Storage path "${path}" cannot leave the storage disk root.`);
	}

	return resolved;
}
