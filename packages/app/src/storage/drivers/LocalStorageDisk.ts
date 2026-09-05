import { FileStorage } from '@flystorage/file-storage';
import { LocalStorageAdapter } from '@flystorage/local-fs';
import { resolve } from 'node:path';

import { resolveLocalStoragePath } from '../path';
import type { LocalStorageDiskConfig } from '../types';
import { FlystorageDisk } from './FlystorageDisk';

/**
 * Local filesystem storage disk.
 *
 * Paths are always relative to the configured disk root. The disk rejects empty,
 * absolute, and parent-directory paths before touching the filesystem.
 */
export class LocalStorageDisk extends FlystorageDisk {
	private readonly root: string;

	/**
	 * Creates a local disk backed by Flystorage's local filesystem adapter.
	 *
	 * @param name - Configured disk name.
	 * @param config - Local disk configuration.
	 */
	constructor(name: string, config: LocalStorageDiskConfig = { driver: 'local' }) {
		const root = resolve(config.root ?? 'storage/app');

		super(name, new FileStorage(new LocalStorageAdapter(root, {
			publicUrlOptions: {
				baseUrl: config.url?.replace(/\/+$/, ''),
			},
		})));

		this.root = root;
	}

	/**
	 * Returns the absolute local filesystem path for a storage path.
	 *
	 * @param path - Relative storage path to resolve.
	 * @returns Absolute filesystem path inside the disk root.
	 */
	path(path: string): string {
		return resolveLocalStoragePath(this.root, path);
	}
}
