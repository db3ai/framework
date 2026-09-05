import type { Readable } from 'node:stream';

import type { StorageContents } from '../storage';
import type { MediaFileVisibility } from './constants';
import type { MediaFile } from './MediaFile';
import type { MediaItem } from './MediaItem';
import type { MediaLibrary } from './MediaLibrary';

/**
 * App-owned scope used to find or create a media library.
 */
export interface MediaLibraryScope {
	/** Opaque scope type such as `scout.website` or `scout.organization`. */
	scopeType: string;

	/** Opaque app-owned scope id. */
	scopeId: string;

	/** Scope-local library key. Defaults to `default`. */
	key?: string;

	/** Human-readable library name used when a new library is created. */
	name?: string;

	/** Optional default storage disk for files written into this library. */
	defaultDisk?: string | null;

	/** Optional storage path prefix for files written into this library. */
	pathPrefix?: string | null;

	/** Optional app-owned library metadata. */
	meta?: Record<string, unknown> | null;
}

/**
 * Library input accepted by media manager methods.
 */
export type MediaLibraryInput = MediaLibrary | string;

/**
 * Input for writing a managed file without making it visible in the browser.
 */
export interface MediaStoreFileInput {
	/** Existing media library or library id that will own the file. */
	library: MediaLibraryInput;

	/** File bytes or text accepted by the storage layer. */
	contents: StorageContents;

	/** Optional display filename. Defaults to the file id plus MIME extension. */
	name?: string | null;

	/** MIME type recorded on the file and passed to storage writes. */
	mimeType?: string | null;

	/** Optional storage disk override. Defaults to the library disk or app default. */
	disk?: string | null;

	/** Optional storage path override. Defaults to a library-scoped generated path. */
	path?: string | null;

	/** Optional app-owned source label such as generated-image or upload. */
	source?: string | null;

	/** Storage visibility used for the write. Defaults to private. */
	visibility?: MediaFileVisibility | null;

	/** Optional known byte size. Defaults to the byte length of the supplied contents. */
	size?: number | null;

	/** Optional app-owned file metadata. */
	meta?: Record<string, unknown> | null;
}

/**
 * Input for streaming a managed file without buffering it in application memory.
 */
export interface MediaStoreFileStreamInput extends Omit<MediaStoreFileInput, 'contents'> {
	/** Readable stream containing the file bytes. */
	stream: Readable;

	/** Known byte size, or null when storage should measure the completed stream. */
	size?: number | null;
}

/**
 * Input for showing an existing managed file in the browser tree.
 */
export interface MediaAttachFileInput {
	/** Existing media library or library id that owns the browser tree. */
	library: MediaLibraryInput;

	/** Managed file or file id to place in the browser. */
	file: MediaFile | string;

	/** Slash-prefixed folder path. Defaults to the library root. */
	folderPath?: string | null;

	/** Optional browser row name. Defaults to the file name. */
	name?: string | null;

	/** Optional app-owned item metadata. */
	meta?: Record<string, unknown> | null;
}

/**
 * Input for writing a file and immediately placing it in the browser tree.
 */
export interface MediaStoreVisibleFileInput extends MediaStoreFileInput {
	/** Slash-prefixed folder path for the browser item. Defaults to the library root. */
	folderPath?: string | null;

	/** Optional browser row name. Defaults to the stored filename. */
	itemName?: string | null;

	/** Optional browser item metadata. */
	itemMeta?: Record<string, unknown> | null;
}

/**
 * Input for streaming a file and immediately placing it in the browser tree.
 */
export interface MediaStoreVisibleFileStreamInput extends MediaStoreFileStreamInput {
	/** Slash-prefixed folder path for the browser item. Defaults to the library root. */
	folderPath?: string | null;

	/** Optional browser row name. Defaults to the stored filename. */
	itemName?: string | null;

	/** Optional browser item metadata. */
	itemMeta?: Record<string, unknown> | null;
}

/**
 * Input for reconstructing an image stream before durable browser placement.
 */
export interface MediaStoreReconstructedVisibleImageStreamInput extends Omit<MediaStoreVisibleFileStreamInput, 'mimeType' | 'size'> {
	/** Allowlisted source MIME type used for decoding and canonical output. */
	mimeType: string;
}

/**
 * Result returned after a file is written and placed in the browser tree.
 */
export interface MediaStoredVisibleFile {
	/** Library that owns the file and item. */
	library: MediaLibrary;

	/** Managed file row for loading bytes by ULID. */
	file: MediaFile;

	/** Browser-visible item row that points at the managed file. */
	item: MediaItem;
}

/**
 * Input for creating or finding a browser folder.
 */
export interface MediaFolderInput {
	/** Existing media library or library id that owns the browser tree. */
	library: MediaLibraryInput;

	/** Slash-prefixed folder path to ensure. */
	path: string;

	/** Optional folder metadata applied only when a folder is created. */
	meta?: Record<string, unknown> | null;
}
