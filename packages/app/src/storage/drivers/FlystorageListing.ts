import type { StatEntry } from '@flystorage/file-storage';

import type { StorageEntry, StorageListing } from '../contracts';

/**
 * Normalizes a Flystorage directory listing behind Platform's storage contract.
 */
export class FlystorageListing implements StorageListing {
	/**
	 * Creates a Platform listing over a Flystorage stat-entry source.
	 *
	 * @param listing - Lazy Flystorage directory entries.
	 */
	constructor(private readonly listing: AsyncIterable<StatEntry>) {}

	/**
	 * Collects all remaining entries from the underlying listing.
	 *
	 * @param sorted - Whether entries should be sorted by path.
	 * @returns Normalized storage entries.
	 */
	async toArray(sorted = true): Promise<StorageEntry[]> {
		const entries: StorageEntry[] = [];

		for await (const entry of this) {
			entries.push(entry);
		}

		if (sorted) {
			entries.sort((left, right) => left.path.localeCompare(right.path));
		}

		return entries;
	}

	/**
	 * Streams normalized storage entries from the underlying listing.
	 *
	 * @returns Async generator of normalized storage entries.
	 */
	async *[Symbol.asyncIterator](): AsyncGenerator<StorageEntry> {
		for await (const entry of this.listing) {
			yield storageEntry(entry);
		}
	}
}

/**
 * Converts one Flystorage stat entry into Platform's provider-neutral shape.
 *
 * @param entry - Flystorage file or directory metadata.
 * @returns Normalized Platform storage entry.
 */
function storageEntry(entry: StatEntry): StorageEntry {
	const lastModified = entry.lastModifiedMs === undefined
		? undefined
		: new Date(entry.lastModifiedMs);

	if (entry.type === 'file') {
		return {
			type: 'file',
			isFile: true,
			isDirectory: false,
			path: entry.path,
			lastModified,
			size: entry.size,
			mimeType: entry.mimeType,
		};
	}

	return {
		type: 'directory',
		isFile: false,
		isDirectory: true,
		path: entry.path,
		lastModified,
	};
}
