import type { Readable } from 'node:stream';

import { LocalStorageDisk } from './drivers/LocalStorageDisk';
import { S3StorageDisk } from './drivers/S3StorageDisk';
import type { StorageListing, StorageListOptions } from './contracts';
import type { LocalStorageDiskConfig, S3StorageDiskConfig, StorageContents, StorageDisk, StorageDiskConfig, StorageDiskFactory, StorageOptions, StoragePutOptions } from './types';

/**
 * Storage manager for configured application disks.
 *
 * This service owns disk discovery and caching. App code should usually use the
 * default disk or a named disk instead of constructing driver classes directly.
 */
export class Storage {
	private readonly disks = new Map<string, StorageDisk>();
	private readonly drivers = new Map<string, StorageDiskFactory>();

	/**
	 * Creates a storage manager with built-in local disk support.
	 *
	 * @param options - Storage defaults, disk definitions, and custom drivers.
	 */
	constructor(private readonly options: StorageOptions = {}) {
		this.drivers.set('local', (name, config) => {
			return new LocalStorageDisk(name, config as LocalStorageDiskConfig);
		});
		this.drivers.set('s3', (name, config) => {
			return new S3StorageDisk(name, config as S3StorageDiskConfig);
		});

		for (const [driver, factory] of Object.entries(options.drivers ?? {})) {
			this.drivers.set(driver, factory);
		}
	}

	/**
	 * Returns the default disk name for this storage manager.
	 *
	 * @returns Configured default disk name.
	 */
	get defaultDiskName(): string {
		return this.options.default ?? 'local';
	}

	/**
	 * Returns a configured storage disk by name.
	 *
	 * @param name - Optional disk name; defaults to the configured default disk.
	 * @returns Cached storage disk instance.
	 *
	 * @example
	 * ```ts
	 * await app.storage.disk('agent').put('images/header.png', bytes);
	 * ```
	 */
	disk(name: string = this.defaultDiskName): StorageDisk {
		if (this.disks.has(name)) {
			return this.disks.get(name)!;
		}

		const configured = this.resolveDiskConfig(name);
		const disk = isStorageDisk(configured)
			? configured
			: this.createDisk(name, configured);

		this.disks.set(name, disk);

		return disk;
	}

	/**
	 * Alias for disk(), matching Laravel's drive naming.
	 *
	 * @param name - Optional disk name; defaults to the configured default disk.
	 * @returns Cached storage disk instance.
	 */
	drive(name: string = this.defaultDiskName): StorageDisk {
		return this.disk(name);
	}

	/**
	 * Registers a storage disk instance for tests or providers.
	 *
	 * @param name - Disk name to register.
	 * @param disk - Concrete disk instance.
	 * @returns This storage manager.
	 */
	setDisk(name: string, disk: StorageDisk): this {
		this.disks.set(name, disk);

		return this;
	}

	/**
	 * Registers a named storage driver factory.
	 *
	 * @param name - Driver name used in disk config.
	 * @param factory - Factory that creates a disk from config.
	 * @returns This storage manager.
	 */
	registerDriver(name: string, factory: StorageDiskFactory): this {
		this.drivers.set(name, factory);

		return this;
	}

	/**
	 * Writes file contents to the default disk.
	 *
	 * Alias for put(), useful when working from a shell or REPL.
	 *
	 * @param path - Relative storage path to write.
	 * @param contents - Bytes or text content to persist.
	 * @param options - Optional write metadata.
	 * @returns Promise that resolves once the file is written.
	 */
	write(path: string, contents: StorageContents, options?: StoragePutOptions): Promise<void> {
		return this.disk().write(path, contents, options);
	}

	/**
	 * Writes file contents to the default disk.
	 *
	 * @param path - Relative storage path to write.
	 * @param contents - Bytes or text content to persist.
	 * @param options - Optional write metadata.
	 * @returns Promise that resolves once the file is written.
	 */
	put(path: string, contents: StorageContents, options?: StoragePutOptions): Promise<void> {
		return this.disk().put(path, contents, options);
	}

	/**
	 * Writes streamed file contents to the default disk.
	 *
	 * @param path - Relative storage path to write.
	 * @param stream - Readable stream containing file bytes.
	 * @param options - Optional write metadata.
	 * @returns Promise that resolves once the stream is written.
	 */
	writeStream(path: string, stream: Readable, options?: StoragePutOptions): Promise<void> {
		return this.disk().writeStream(path, stream, options);
	}

	/**
	 * Lists files and directories beneath a path on the default disk.
	 *
	 * @param path - Relative directory path, or an empty string for the disk root.
	 * @param options - Directory traversal options.
	 * @returns Lazy provider-neutral directory listing.
	 */
	list(path = '', options: StorageListOptions = {}): StorageListing {
		return this.disk().list(path, options);
	}

	/**
	 * Reads file contents from the default disk.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored file bytes.
	 */
	get(path: string): Promise<Buffer> {
		return this.disk().get(path);
	}

	/**
	 * Reads file contents as text from the default disk.
	 *
	 * Matches Flystorage's readToString() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored text content.
	 */
	readToString(path: string): Promise<string> {
		return this.disk().readToString(path);
	}

	/**
	 * Reads file contents into a Buffer from the default disk.
	 *
	 * Matches Flystorage's readToBuffer() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored file bytes.
	 */
	readToBuffer(path: string): Promise<Buffer> {
		return this.disk().readToBuffer(path);
	}

	/**
	 * Reads file contents into a Uint8Array from the default disk.
	 *
	 * Matches Flystorage's readToUint8Array() API.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Stored file bytes.
	 */
	readToUint8Array(path: string): Promise<Uint8Array> {
		return this.disk().readToUint8Array(path);
	}

	/**
	 * Reads file contents as a stream from the default disk.
	 *
	 * Matches Flystorage's read() API. Use get() or getText() when the caller
	 * intentionally wants buffered contents instead.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Readable stream for the stored file.
	 */
	read(path: string): Promise<Readable> {
		return this.disk().read(path);
	}

	/**
	 * Reads file contents as a stream from the default disk.
	 *
	 * @param path - Relative storage path to read.
	 * @returns Readable stream for the stored file.
	 */
	readStream(path: string): Promise<Readable> {
		return this.disk().readStream(path);
	}

	/**
	 * Reads file contents as text from the default disk.
	 *
	 * @param path - Relative storage path to read.
	 * @param encoding - Text encoding used to decode the bytes.
	 * @returns Stored text content.
	 */
	getText(path: string, encoding?: BufferEncoding): Promise<string> {
		return this.disk().getText(path, encoding);
	}

	/**
	 * Checks whether a file exists on the default disk.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns True when the file exists.
	 */
	exists(path: string): Promise<boolean> {
		return this.disk().exists(path);
	}

	/**
	 * Checks whether a file is missing from the default disk.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns True when the file does not exist.
	 */
	missing(path: string): Promise<boolean> {
		return this.disk().missing(path);
	}

	/**
	 * Deletes a file from the default disk.
	 *
	 * @param path - Relative storage path to delete.
	 * @returns True when a file was removed.
	 */
	delete(path: string): Promise<boolean> {
		return this.disk().delete(path);
	}

	/**
	 * Copies a file on the default disk.
	 *
	 * @param from - Existing relative storage path.
	 * @param to - New relative storage path.
	 * @returns Promise that resolves once the file is copied.
	 */
	copy(from: string, to: string): Promise<void> {
		return this.disk().copy(from, to);
	}

	/**
	 * Moves a file on the default disk.
	 *
	 * @param from - Existing relative storage path.
	 * @param to - New relative storage path.
	 * @returns Promise that resolves once the file is moved.
	 */
	move(from: string, to: string): Promise<void> {
		return this.disk().move(from, to);
	}

	/**
	 * Returns file size from the default disk.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns File size in bytes.
	 */
	size(path: string): Promise<number> {
		return this.disk().size(path);
	}

	/**
	 * Returns the last modification time from the default disk.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns Last modified date.
	 */
	lastModified(path: string): Promise<Date> {
		return this.disk().lastModified(path);
	}

	/**
	 * Returns a MIME type for a path on the default disk.
	 *
	 * @param path - Relative storage path to inspect.
	 * @returns MIME type inferred by the disk.
	 */
	mimeType(path: string): Promise<string> {
		return this.disk().mimeType(path);
	}

	/**
	 * Returns a public URL for a path on the default disk.
	 *
	 * @param path - Relative storage path to expose.
	 * @returns Public URL.
	 */
	url(path: string): Promise<string> {
		return this.disk().url(path);
	}

	/**
	 * Returns an absolute filesystem path for a path on the default disk.
	 *
	 * @param path - Relative storage path to resolve.
	 * @returns Absolute filesystem path.
	 */
	path(path: string): string {
		return this.disk().path(path);
	}

	/**
	 * Resolves configured disk options or the built-in local default.
	 *
	 * @param name - Disk name to resolve.
	 * @returns Disk config or concrete disk instance.
	 */
	private resolveDiskConfig(name: string): StorageDiskConfig | StorageDisk {
		const configured = this.options.disks?.[name];

		if (configured) {
			return configured;
		}

		if (name === 'local') {
			return {
				driver: 'local',
				root: 'storage/app',
			};
		}

		throw new Error(`Storage disk "${name}" is not configured.`);
	}

	/**
	 * Creates a disk through the configured driver factory.
	 *
	 * @param name - Disk name being created.
	 * @param config - Disk configuration.
	 * @returns Storage disk instance.
	 */
	private createDisk(name: string, config: StorageDiskConfig): StorageDisk {
		const factory = this.drivers.get(config.driver);

		if (!factory) {
			throw new Error(`Storage driver "${config.driver}" is not registered.`);
		}

		return factory(name, config);
	}
}

/**
 * Checks whether a configured disk value already implements the disk contract.
 *
 * @param value - Configured disk value.
 * @returns True when value is a storage disk instance.
 */
function isStorageDisk(value: StorageDiskConfig | StorageDisk): value is StorageDisk {
	return typeof value === 'object'
		&& value !== null
		&& 'put' in value
		&& 'get' in value
		&& typeof (value as StorageDisk).put === 'function'
		&& typeof (value as StorageDisk).get === 'function';
}
