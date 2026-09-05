/**
 * Controls how a storage directory is enumerated.
 */
export interface StorageListOptions {
	/** Whether descendants below the immediate directory should be included. */
	deep?: boolean;
}

/**
 * Metadata shared by files and directories returned from storage listings.
 */
export interface StorageEntryBase {
	/** Relative path within the selected storage disk. */
	path: string;
	/** Last modification time when the storage provider exposes it. */
	lastModified?: Date;
}

/**
 * File metadata returned from a storage directory listing.
 */
export interface StorageFileEntry extends StorageEntryBase {
	type: 'file';
	isFile: true;
	isDirectory: false;
	/** File size in bytes when the storage provider exposes it. */
	size?: number;
	/** Stored MIME type when the storage provider exposes it. */
	mimeType?: string;
}

/**
 * Directory metadata returned from a storage directory listing.
 */
export interface StorageDirectoryEntry extends StorageEntryBase {
	type: 'directory';
	isFile: false;
	isDirectory: true;
}

/** One normalized file or directory returned from a storage listing. */
export type StorageEntry = StorageFileEntry | StorageDirectoryEntry;

/**
 * Lazy directory listing that can be streamed or collected into an array.
 */
export interface StorageListing extends AsyncIterable<StorageEntry> {
	/**
	 * Collects all remaining entries in this listing.
	 *
	 * @param sorted - Whether entries should be sorted by path.
	 * @returns Storage entries from this listing.
	 */
	toArray(sorted?: boolean): Promise<StorageEntry[]>;
}
