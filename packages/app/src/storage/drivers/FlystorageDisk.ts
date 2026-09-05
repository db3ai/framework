import type { FileStorage } from '@flystorage/file-storage';
import type { Readable } from 'node:stream';

import { storageContentsToBuffer } from '../contents';
import { mimeTypeFromPath } from '../mime';
import { normalizeStorageDirectoryPath, normalizeStoragePath } from '../path';
import type { StorageListing, StorageListOptions } from '../contracts';
import type { StorageContents, StorageDisk, StoragePutOptions } from '../types';
import { FlystorageListing } from './FlystorageListing';

/**
 * Base storage disk for drivers backed by Flystorage.
 */
export class FlystorageDisk implements StorageDisk {
	/**
	 * Creates a Flystorage-backed disk wrapper.
	 *
	 * @param name - Configured disk name.
	 * @param storage - Flystorage instance used for disk operations.
	 */
	constructor(
		readonly name: string,
		protected readonly storage: FileStorage,
	) {}

	/**
	 * Writes file contents to this disk.
	 *
	 * Alias for put(), useful when testing storage from a shell or REPL.
	 *
	 * @param path - Relative storage path to write.
	 * @param contents - Bytes or text content to persist.
	 * @param options - Optional write metadata reserved for compatible drivers.
	 * @returns Promise that resolves once the file is written.
	 */
	write(path: string, contents: StorageContents, options: StoragePutOptions = {}): Promise<void> {
		return this.put(path, contents, options);
	}

	/**
	 * Writes file contents to this disk.
	 *
	 * @param path - Relative storage path to write.
	 * @param contents - Bytes or text content to persist.
	 * @param options - Optional write metadata reserved for compatible drivers.
	 * @returns Promise that resolves once the file is written.
	 */
	async put(path: string, contents: StorageContents, options: StoragePutOptions = {}): Promise<void> {
		await this.storage.write(
			normalizeStoragePath(path),
			storageContentsToBuffer(contents),
			{
				mimeType: options.mimeType,
				visibility: options.visibility,
			},
		);
	}

	/**
	 * Writes streamed file contents to this disk.
	 *
	 * @param path - Relative storage path to write.
	 * @param stream - Readable stream containing file bytes.
	 * @param options - Optional write metadata reserved for compatible drivers.
	 * @returns Promise that resolves once the stream is written.
	 */
	async writeStream(path: string, stream: Readable, options: StoragePutOptions = {}): Promise<void> {
		await this.storage.write(
			normalizeStoragePath(path),
			stream,
			{
				mimeType: options.mimeType,
				visibility: options.visibility,
			},
		);
	}

	/**
	 * Lists files and directories beneath a path on this disk.
	 *
	 * @param path - Relative directory path, or an empty string for the disk root.
	 * @param options - Directory traversal options.
	 * @returns Lazy provider-neutral directory listing.
	 */
	list(path = '', options: StorageListOptions = {}): StorageListing {
		return new FlystorageListing(this.storage.list(
			normalizeStorageDirectoryPath(path),
			{
				deep: options.deep ?? false,
			},
		));
	}

	/**
	 * Reads a file from this disk as bytes.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored file bytes.
	 */
	async get(path: string): Promise<Buffer> {
		return this.readToBuffer(path);
	}

	/**
	 * Reads a file from this disk as text.
	 *
	 * Matches Flystorage's readToString() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored text content.
	 */
	async readToString(path: string): Promise<string> {
		return this.storage.readToString(normalizeStoragePath(path));
	}

	/**
	 * Reads a file from this disk as a Buffer.
	 *
	 * Matches Flystorage's readToBuffer() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored file bytes.
	 */
	async readToBuffer(path: string): Promise<Buffer> {
		return this.storage.readToBuffer(normalizeStoragePath(path));
	}

	/**
	 * Reads a file from this disk as a Uint8Array.
	 *
	 * Matches Flystorage's readToUint8Array() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored file bytes.
	 */
	async readToUint8Array(path: string): Promise<Uint8Array> {
		return this.storage.readToUint8Array(normalizeStoragePath(path));
	}

	/**
	 * Reads a file from this disk as a stream.
	 *
	 * Matches Flystorage's read() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Readable stream for the stored file.
	 */
	async read(path: string): Promise<Readable> {
		return this.storage.read(normalizeStoragePath(path));
	}

	/**
	 * Reads a file from this disk as a stream.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Readable stream for the stored file.
	 */
	async readStream(path: string): Promise<Readable> {
		return this.read(path);
	}

	/**
	 * Reads a file from this disk as text.
	 *
	 * @param path - Relative storage path to read.
	 * @param encoding - Text encoding used to decode the bytes.
	 * @returns Stored text content.
	 */
	async getText(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
		return (await this.readToBuffer(path)).toString(encoding);
	}

	/**
	 * Checks whether a file exists on this disk.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns True when the file exists.
	 */
	async exists(path: string): Promise<boolean> {
		return this.storage.fileExists(normalizeStoragePath(path));
	}

	/**
	 * Checks whether a file is missing from this disk.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns True when the file does not exist.
	 */
	async missing(path: string): Promise<boolean> {
		return !(await this.exists(path));
	}

	/**
	 * Deletes a file from this disk.
	 *
	 * @param path - Relative storage path to delete.
	 * @returns True when a file was removed.
	 */
	async delete(path: string): Promise<boolean> {
		const normalized = normalizeStoragePath(path);
		const exists = await this.storage.fileExists(normalized);

		await this.storage.deleteFile(normalized);

		return exists;
	}

	/**
	 * Copies a file to another path on this disk.
	 *
	 * @param from - Existing relative storage path.
	 * @param to - New relative storage path.
	 * @returns Promise that resolves once the file is copied.
	 */
	async copy(from: string, to: string): Promise<void> {
		await this.storage.copyFile(
			normalizeStoragePath(from),
			normalizeStoragePath(to),
		);
	}

	/**
	 * Moves a file to another path on this disk.
	 *
	 * @param from - Existing relative storage path.
	 * @param to - New relative storage path.
	 * @returns Promise that resolves once the file is moved.
	 */
	async move(from: string, to: string): Promise<void> {
		await this.storage.moveFile(
			normalizeStoragePath(from),
			normalizeStoragePath(to),
		);
	}

	/**
	 * Returns file size in bytes.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns File size in bytes.
	 */
	async size(path: string): Promise<number> {
		return this.storage.fileSize(normalizeStoragePath(path));
	}

	/**
	 * Returns the last modification date for a file.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns Last modified date.
	 */
	async lastModified(path: string): Promise<Date> {
		return new Date(await this.storage.lastModified(normalizeStoragePath(path)));
	}

	/**
	 * Returns a MIME type for a storage path.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns MIME type inferred from the file extension or storage metadata.
	 */
	async mimeType(path: string): Promise<string> {
		const normalized = normalizeStoragePath(path);

		try {
			return await this.storage.mimeType(normalized, {
				fallbackMethod: 'path',
			});
		} catch {
			return mimeTypeFromPath(normalized);
		}
	}

	/**
	 * Builds a public URL for this disk when supported by the driver.
	 *
	 * @param path - Relative storage path to expose.
	 * @returns Public URL for the storage path.
	 */
	async url(path: string): Promise<string> {
		return this.storage.publicUrl(normalizeStoragePath(path));
	}

	/**
	 * Reports that this disk is not backed by a local filesystem path.
	 *
	 * @param path - Relative storage path requested by the caller.
	 * @returns This method never returns for non-local disks.
	 */
	path(path: string): string {
		normalizeStoragePath(path);

		throw new Error(`Storage disk "${this.name}" does not expose local filesystem paths.`);
	}
}
