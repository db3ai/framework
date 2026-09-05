import type { Readable } from 'node:stream';

import type { StorageListing, StorageListOptions } from './contracts';

export type StorageVisibility = 'public' | 'private';

export type StorageContents = string | Buffer | Uint8Array | ArrayBuffer;

export interface StoragePutOptions {
	visibility?: StorageVisibility;
	mimeType?: string;
}

export interface StorageFileStat {
	path: string;
	size: number;
	lastModified: Date;
}

/**
 * Runtime interface implemented by configured storage disks.
 */
export interface StorageDisk {
	readonly name: string;

	/**
	 * Writes file contents to a path on this disk.
	 *
	 * Alias for put(), useful for command-line and REPL usage.
	 *
	 * @param path - Relative storage path to write.
	 * @param contents - Bytes or text content to persist.
	 * @param options - Optional write metadata.
	 * @returns Promise that resolves once the file is written.
	 */
	write(path: string, contents: StorageContents, options?: StoragePutOptions): Promise<void>;

	/**
	 * Writes file contents to a path on this disk.
	 *
	 * @param path - Relative storage path to write.
	 * @param contents - Bytes or text content to persist.
	 * @param options - Optional write metadata.
	 * @returns Promise that resolves once the file is written.
	 */
	put(path: string, contents: StorageContents, options?: StoragePutOptions): Promise<void>;

	/**
	 * Writes streamed file contents to a path on this disk.
	 *
	 * @param path - Relative storage path to write.
	 * @param stream - Readable stream containing file bytes.
	 * @param options - Optional write metadata.
	 * @returns Promise that resolves once the stream is written.
	 */
	writeStream(path: string, stream: Readable, options?: StoragePutOptions): Promise<void>;

	/**
	 * Lists files and directories beneath a path on this disk.
	 *
	 * @param path - Relative directory path, or an empty string for the disk root.
	 * @param options - Directory traversal options.
	 * @returns Lazy provider-neutral directory listing.
	 */
	list(path?: string, options?: StorageListOptions): StorageListing;

	/**
	 * Reads file contents as bytes from this disk.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored file contents.
	 */
	get(path: string): Promise<Buffer>;

	/**
	 * Reads file contents into a string from this disk.
	 *
	 * Matches Flystorage's readToString() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored text content.
	 */
	readToString(path: string): Promise<string>;

	/**
	 * Reads file contents into a Buffer from this disk.
	 *
	 * Matches Flystorage's readToBuffer() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored file contents.
	 */
	readToBuffer(path: string): Promise<Buffer>;

	/**
	 * Reads file contents into a Uint8Array from this disk.
	 *
	 * Matches Flystorage's readToUint8Array() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored file contents.
	 */
	readToUint8Array(path: string): Promise<Uint8Array>;

	/**
	 * Reads file contents as a stream from this disk.
	 *
	 * Matches Flystorage's read() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Readable stream for the stored file.
	 */
	read(path: string): Promise<Readable>;

	/**
	 * Reads file contents as a stream from this disk.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Readable stream for the stored file.
	 */
	readStream(path: string): Promise<Readable>;

	/**
	 * Reads file contents as text from this disk.
	 *
	 * @param path - Relative storage path to read.
	 * @param encoding - Text encoding used to decode the file.
	 * @returns Stored text content.
	 */
	getText(path: string, encoding?: BufferEncoding): Promise<string>;

	/**
	 * Returns true when a file exists at the given path.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns True when the file exists.
	 */
	exists(path: string): Promise<boolean>;

	/**
	 * Returns true when a file does not exist at the given path.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns True when the file is missing.
	 */
	missing(path: string): Promise<boolean>;

	/**
	 * Deletes a file from this disk.
	 *
	 * @param path - Relative storage path to delete.
	 * @returns True when a file was deleted.
	 */
	delete(path: string): Promise<boolean>;

	/**
	 * Copies a file between two paths on this disk.
	 *
	 * @param from - Existing relative storage path.
	 * @param to - New relative storage path.
	 * @returns Promise that resolves once the copy is complete.
	 */
	copy(from: string, to: string): Promise<void>;

	/**
	 * Moves a file between two paths on this disk.
	 *
	 * @param from - Existing relative storage path.
	 * @param to - New relative storage path.
	 * @returns Promise that resolves once the move is complete.
	 */
	move(from: string, to: string): Promise<void>;

	/**
	 * Returns file size in bytes.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns File size in bytes.
	 */
	size(path: string): Promise<number>;

	/**
	 * Returns the last modification time for a file.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns File modification date.
	 */
	lastModified(path: string): Promise<Date>;

	/**
	 * Returns a best-effort MIME type for a file path.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns MIME type for the file extension.
	 */
	mimeType(path: string): Promise<string>;

	/**
	 * Returns a public URL for a path when the disk supports URLs.
	 *
	 * @param path - Relative storage path to expose.
	 * @returns Public URL.
	 */
	url(path: string): Promise<string>;

	/**
	 * Returns an absolute filesystem path when the disk is local.
	 *
	 * @param path - Relative storage path to resolve.
	 * @returns Absolute filesystem path.
	 */
	path(path: string): string;
}

export interface LocalStorageDiskConfig {
	driver: 'local';
	root?: string;
	url?: string;
	visibility?: StorageVisibility;
}

export interface S3StorageDiskConfig {
	driver: 's3';
	bucket: string;
	region?: string;
	endpoint?: string;
	prefix?: string;
	url?: string;
	forcePathStyle?: boolean;
	accessKeyId?: string;
	secretAccessKey?: string;
	sessionToken?: string;
	key?: string;
	secret?: string;
	visibility?: StorageVisibility;
}

export interface CustomStorageDiskConfig {
	driver: string;
	[key: string]: unknown;
}

export type StorageDiskConfig = LocalStorageDiskConfig | S3StorageDiskConfig | CustomStorageDiskConfig;

export type StorageDiskFactory = (name: string, config: StorageDiskConfig) => StorageDisk;

export interface StorageOptions {
	default?: string;
	disks?: Record<string, StorageDiskConfig | StorageDisk>;
	drivers?: Record<string, StorageDiskFactory>;
}
