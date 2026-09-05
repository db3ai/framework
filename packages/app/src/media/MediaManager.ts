import type { Readable } from 'node:stream';

import { mimeTypeFromPath } from '../storage/mime';
import { normalizeStoragePath } from '../storage/path';
import type { Storage, StorageContents, StorageDisk, StorageVisibility } from '../storage';
import { MEDIA_FILE_VISIBILITY, MEDIA_ITEM_TYPE, MEDIA_LIBRARY_DEFAULT_KEY } from './constants';
import type { MediaOptions } from './contracts';
import { ImageReconstructionError, ImageVariantRenderer, SharpImageProcessor, type ImageProcessor, type ImageVariant, type ImageVariantOptions } from './image';
import { MediaFile } from './MediaFile';
import { MediaItem } from './MediaItem';
import { MediaLibrary } from './MediaLibrary';
import type { MediaAttachFileInput, MediaFolderInput, MediaLibraryInput, MediaLibraryScope, MediaStoreFileInput, MediaStoreFileStreamInput, MediaStoreReconstructedVisibleImageStreamInput, MediaStoredVisibleFile, MediaStoreVisibleFileInput, MediaStoreVisibleFileStreamInput } from './types';

type MediaFileWriter = (
	disk: StorageDisk,
	path: string,
	mimeType: string,
	visibility: StorageVisibility,
) => Promise<void>;

const MEDIA_ITEM_NAME_CONFLICT_RETRIES = 10;
const RECONSTRUCTIBLE_IMAGE_MIME_TYPES = new Set([
	'image/avif',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/webp',
]);

/**
 * Framework service for managed media libraries, files, and browser items.
 *
 * Storage remains responsible for bytes. This manager records file metadata,
 * scopes files through media libraries, and creates optional folder-tree rows
 * for media browser UIs.
 */
export class MediaManager {
	readonly #imageProcessor: ImageProcessor;
	readonly #imageVariants: ImageVariantRenderer;

	/**
	 * Creates a media manager backed by the application storage service.
	 *
	 * @param storage - Storage manager used to write and read file bytes.
	 * @param options - Media rendering and derived-file cache configuration.
	 * @param imageProcessor - Concrete image processing engine.
	 */
	constructor(
		private readonly storage: Storage,
		options: MediaOptions = {},
		imageProcessor: ImageProcessor = new SharpImageProcessor(),
	) {
		this.#imageProcessor = imageProcessor;
		this.#imageVariants = new ImageVariantRenderer(storage, options.images, imageProcessor);
	}

	/**
	 * Finds or creates the media library for an application-owned scope.
	 *
	 * @param input - Scope identity and defaults for a new library.
	 * @returns Existing or newly-created media library.
	 *
	 * @example
	 * const library = await app.media.libraryFor({
	 * 	scopeType: 'scout.website',
	 * 	scopeId: website.id,
	 * 	key: 'default',
	 * 	name: 'Website media',
	 * });
	 */
	async libraryFor(input: MediaLibraryScope): Promise<MediaLibrary> {
		const scopeType = requiredString(input.scopeType, 'Media library scopeType is required.');
		const scopeId = requiredString(input.scopeId, 'Media library scopeId is required.');
		const key = normalizeLibraryKey(input.key);
		const existing = await MediaLibrary
			.where({
				scopeType,
				scopeId,
				key,
			})
			.first();

		if (existing) return existing;

		const library = MediaLibrary.create({
			scopeType,
			scopeId,
			key,
			name: input.name || defaultLibraryName(scopeType, key),
			defaultDisk: input.defaultDisk ?? null,
			pathPrefix: input.pathPrefix ?? null,
			meta: input.meta ?? null,
		});

		await library.save();

		return library;
	}

	/**
	 * Loads one media library by id.
	 *
	 * @param id - Media library ULID.
	 * @returns Media library row or null.
	 */
	library(id: string): Promise<MediaLibrary | null> {
		return MediaLibrary.find(id);
	}

	/**
	 * Loads one managed file by id.
	 *
	 * @param id - Managed file ULID.
	 * @returns Managed file row or null.
	 */
	file(id: string): Promise<MediaFile | null> {
		return MediaFile.find(id);
	}

	/**
	 * Writes bytes to storage and records a managed file row.
	 *
	 * The file is not visible in the media browser until `attachFile()` creates a
	 * `MediaItem` that points to it.
	 *
	 * @param input - File contents, library, storage options, and metadata.
	 * @returns Managed file row.
	 */
	async storeFile(input: MediaStoreFileInput): Promise<MediaFile> {
		return this.#storeFile(
			input,
			input.size ?? storageContentsByteLength(input.contents),
			(disk, path, mimeType, visibility) => disk.put(path, input.contents, {
				mimeType,
				visibility,
			}),
		);
	}

	/**
	 * Streams bytes to storage and records a managed file row.
	 *
	 * This is the preferred media finalization path for resumable uploads because
	 * completed temporary files do not need to be buffered in application memory.
	 *
	 * @param input - File stream, library, storage options, and metadata.
	 * @returns Managed file row.
	 */
	async storeFileStream(input: MediaStoreFileStreamInput): Promise<MediaFile> {
		return this.#storeFile(
			input,
			input.size ?? null,
			(disk, path, mimeType, visibility) => disk.writeStream(path, input.stream, {
				mimeType,
				visibility,
			}),
		);
	}

	/**
	 * Reads managed file bytes from the storage disk recorded on the file row.
	 *
	 * @param fileOrId - Managed file row or id.
	 * @returns Stored file bytes.
	 */
	async readFile(fileOrId: MediaFile | string): Promise<Buffer> {
		const file = await this.#resolveFile(fileOrId);
		const diskName = requiredString(file.disk, 'Managed file disk is required.');
		const path = requiredString(file.path, 'Managed file path is required.');

		return this.storage.disk(diskName).get(path);
	}

	/**
	 * Opens a managed file as a storage-backed readable stream.
	 *
	 * @param fileOrId - Managed file row or ULID.
	 * @returns Stream containing the stored file bytes.
	 */
	async readFileStream(fileOrId: MediaFile | string): Promise<Readable> {
		const file = await this.#resolveFile(fileOrId);
		const diskName = requiredString(file.disk, 'Managed file disk is required.');
		const path = requiredString(file.path, 'Managed file path is required.');

		return this.storage.disk(diskName).readStream(path);
	}

	/**
	 * Renders a responsive managed image into the configured disposable cache.
	 *
	 * @param fileOrId - Managed image row or ULID.
	 * @param options - Requested responsive image dimensions.
	 * @returns Rendered image stream and cache metadata.
	 *
	 * @example
	 * const image = await app.media.renderImage(imageId, {
	 * 	width: 640,
	 * });
	 */
	async renderImage(fileOrId: MediaFile | string, options: ImageVariantOptions): Promise<ImageVariant> {
		const file = await this.#resolveFile(fileOrId);

		return this.#imageVariants.render(file, options);
	}

	/**
	 * Permanently deletes a managed file, its browser placements, and stored bytes.
	 *
	 * Browser item rows are removed through their database foreign key to the
	 * managed file. Disposable responsive-image variants are cleared before the
	 * durable source bytes and database record are removed.
	 *
	 * @param fileOrId - Managed file row or ULID to permanently delete.
	 */
	async deleteFile(fileOrId: MediaFile | string): Promise<void> {
		const file = await this.#resolveFile(fileOrId);
		const diskName = requiredString(file.disk, 'Managed file disk is required.');
		const path = requiredString(file.path, 'Managed file path is required.');

		await this.#imageVariants.deleteCachedVariants(file);
		await this.storage.disk(diskName).delete(path);
		await file.delete();
	}

	/**
	 * Finds or creates the root browser item for a library.
	 *
	 * @param libraryOrId - Media library row or id.
	 * @returns Root browser item for the library.
	 */
	async rootFor(libraryOrId: MediaLibraryInput): Promise<MediaItem> {
		const library = await this.#resolveLibrary(libraryOrId);
		const existing = await MediaItem
			.where('library', library)
			.where('type', MEDIA_ITEM_TYPE.root)
			.first();

		if (existing) return existing;

		const root = MediaItem.create({
			library,
			type: MEDIA_ITEM_TYPE.root,
			root: null,
			parent: null,
			file: null,
			name: 'Root',
			path: '/',
			meta: null,
		});

		await root.save();

		return root;
	}

	/**
	 * Finds or creates a slash-prefixed browser folder path.
	 *
	 * @param input - Library and folder path to ensure.
	 * @returns Folder item for the requested path, or the root for `/`.
	 */
	async ensureFolder(input: MediaFolderInput): Promise<MediaItem> {
		const library = await this.#resolveLibrary(input.library);
		const path = normalizeMediaPath(input.path);

		if (path === '/') return this.rootFor(library);

		const existing = await MediaItem
			.where({
				library,
				path,
			})
			.first();

		if (existing) return existing;

		const root = await this.rootFor(library);
		const segments = pathSegments(path);
		let parent = root;
		let currentPath = '';

		for (const segment of segments) {
			currentPath = joinMediaPath(currentPath || '/', segment);

			let folder = await MediaItem
				.where({
					library,
					path: currentPath,
				})
				.first();

			if (!folder) {
				folder = MediaItem.create({
					library,
					type: MEDIA_ITEM_TYPE.directory,
					root,
					parent,
					file: null,
					name: segment,
					path: currentPath,
					meta: currentPath === path ? input.meta ?? null : null,
				});
				await folder.save();
			}

			parent = folder;
		}

		return parent;
	}

	/**
	 * Places an existing managed file into the browser tree.
	 *
	 * @param input - File, target library, folder path, and optional item metadata.
	 * @returns Browser item pointing at the managed file.
	 */
	async attachFile(input: MediaAttachFileInput): Promise<MediaItem> {
		const library = await this.#resolveLibrary(input.library);
		const file = await this.#resolveFile(input.file);
		const root = await this.rootFor(library);
		const parent = await this.ensureFolder({
			library,
			path: input.folderPath || '/',
		});
		const requestedName = normalizeFileName(input.name || file.name, file.mimeType);
		const existingItems = await MediaItem
			.where({
				library,
				parent,
			})
			.all();
		const existingPaths = new Set(existingItems.flatMap(item => item.path ? [item.path] : []));
		let sequence = 1;
		let conflictRetries = 0;

		while (conflictRetries <= MEDIA_ITEM_NAME_CONFLICT_RETRIES) {
			const name = numberedMediaItemName(requestedName, sequence);
			const path = joinMediaPath(parent.path || '/', name);

			sequence += 1;

			if (existingPaths.has(path)) continue;

			const item = MediaItem.create({
				library,
				type: MEDIA_ITEM_TYPE.file,
				root,
				parent,
				file,
				name,
				path,
				meta: input.meta ?? null,
			});

			try {
				await item.save();
				return item;
			} catch (error) {
				const uniqueConflict = isUniqueConstraintError(error);

				if (!uniqueConflict && !isRetriableTransactionConflict(error)) throw error;

				const conflictingItem = await MediaItem
					.where({
						library,
						path,
					})
					.first();

				if (uniqueConflict && !conflictingItem) throw error;

				existingPaths.add(path);
				conflictRetries += 1;
			}
		}

		throw new Error(`Unable to allocate a unique media item name for "${requestedName}".`);
	}

	/**
	 * Writes bytes to storage and creates a browser item for the file.
	 *
	 * @param input - File storage input plus optional browser placement.
	 * @returns Stored file and browser item rows.
	 */
	async storeVisibleFile(input: MediaStoreVisibleFileInput): Promise<MediaStoredVisibleFile> {
		const library = await this.#resolveLibrary(input.library);
		const file = await this.storeFile({
			...input,
			library,
		});
		const item = await this.attachFile({
			library,
			file,
			folderPath: input.folderPath || '/',
			name: input.itemName || file.name,
			meta: input.itemMeta ?? null,
		});

		return {
			library,
			file,
			item,
		};
	}

	/**
	 * Streams bytes to storage and creates a browser item for the file.
	 *
	 * @param input - File stream and storage input plus optional browser placement.
	 * @returns Stored file and browser item rows.
	 */
	async storeVisibleFileStream(input: MediaStoreVisibleFileStreamInput): Promise<MediaStoredVisibleFile> {
		const library = await this.#resolveLibrary(input.library);
		const file = await this.storeFileStream({
			...input,
			library,
		});
		const item = await this.attachFile({
			library,
			file,
			folderPath: input.folderPath || '/',
			name: input.itemName || file.name,
			meta: input.itemMeta ?? null,
		});

		return {
			library,
			file,
			item,
		};
	}

	/**
	 * Fully decodes and reconstructs an untrusted image before durable storage.
	 *
	 * The processor emits new canonical bytes without source metadata or trailing
	 * payloads. No media row becomes visible unless the complete processor stream
	 * is successfully written.
	 *
	 * @param input - Untrusted image stream and browser placement metadata.
	 * @returns Stored reconstructed file and browser item rows.
	 */
	async storeReconstructedVisibleImageStream(
		input: MediaStoreReconstructedVisibleImageStreamInput,
	): Promise<MediaStoredVisibleFile> {
		const mimeType = reconstructibleImageMimeType(input.mimeType);
		const source = input.stream;
		const reconstructed = this.#imageProcessor.reconstruct({
			sourceMimeType: mimeType,
			outputMimeType: mimeType,
		});
		let processorError: Error | null = null;
		let sourceError: Error | null = null;

		source.once('error', error => {
			sourceError = asError(error);
			reconstructed.destroy(sourceError);
		});
		reconstructed.once('error', error => {
			processorError = asError(error);
		});
		source.pipe(reconstructed);

		try {
			return await this.storeVisibleFileStream({
				...input,
				mimeType,
				size: null,
				stream: reconstructed,
			});
		} catch (error) {
			if (sourceError) throw sourceError;

			if (processorError) {
				throw new ImageReconstructionError(
					'The image could not be completely decoded and reconstructed.',
					{
						cause: processorError,
					},
				);
			}

			throw error;
		} finally {
			source.unpipe(reconstructed);
			source.destroy();
			reconstructed.destroy();
		}
	}

	/**
	 * Writes one managed file through the supplied storage operation.
	 *
	 * @param input - Shared managed-file metadata and storage options.
	 * @param size - Known byte size, or null when storage should measure it.
	 * @param write - Concrete buffered or streamed storage write.
	 * @returns Managed file row.
	 */
	async #storeFile(
		input: Omit<MediaStoreFileInput, 'contents'>,
		size: number | null,
		write: MediaFileWriter,
	): Promise<MediaFile> {
		const library = await this.#resolveLibrary(input.library);
		const mimeType = normalizeMimeType(input.mimeType, input.name);
		const requestedName = normalizeOptionalFileName(input.name);
		const diskName = input.disk || library.defaultDisk || this.storage.defaultDiskName;
		const disk = this.storage.disk(diskName);
		const file = MediaFile.create({
			library,
			disk: diskName,
			path: 'pending',
			name: 'pending',
			mimeType,
			size,
			visibility: input.visibility ?? MEDIA_FILE_VISIBILITY.private,
			source: input.source ?? null,
			meta: input.meta ?? null,
		});
		const fileId = requiredString(file.id, 'Generated media file id is required.');
		const name = requestedName || `${fileId}${extensionForMimeType(mimeType)}`;
		const path = input.path
			? normalizeStoragePath(input.path)
			: defaultFilePath(library, fileId, name);
		let wroteGeneratedPath = false;

		file.name = name;
		file.path = path;

		try {
			wroteGeneratedPath = !input.path;
			await write(
				disk,
				path,
				mimeType,
				file.visibility as StorageVisibility,
			);

			if (file.size === null || file.size === undefined) {
				file.size = await disk.size(path);
			}

			await file.save();
		} catch (error) {
			if (wroteGeneratedPath) {
				await deleteStoredFileQuietly(disk, path);
			}
			throw error;
		}

		return file;
	}

	/**
	 * Resolves a library row from a row or id.
	 *
	 * @param libraryOrId - Media library row or id.
	 * @returns Resolved media library.
	 */
	async #resolveLibrary(libraryOrId: MediaLibraryInput): Promise<MediaLibrary> {
		if (libraryOrId instanceof MediaLibrary) return libraryOrId;

		const library = await MediaLibrary.find(libraryOrId);

		if (!library) {
			throw new Error(`Media library "${libraryOrId}" was not found.`);
		}

		return library;
	}

	/**
	 * Resolves a managed file row from a row or id.
	 *
	 * @param fileOrId - Managed file row or id.
	 * @returns Resolved managed file.
	 */
	async #resolveFile(fileOrId: MediaFile | string): Promise<MediaFile> {
		if (fileOrId instanceof MediaFile) return fileOrId;

		const file = await MediaFile.find(fileOrId);

		if (!file) {
			throw new Error(`Media file "${fileOrId}" was not found.`);
		}

		return file;
	}
}

/**
 * Creates the default display name for a new scoped library.
 *
 * @param scopeType - App-owned scope type.
 * @param key - Scope-local library key.
 * @returns Human-readable library name.
 */
function defaultLibraryName(scopeType: string, key: string): string {
	return key === MEDIA_LIBRARY_DEFAULT_KEY
		? `${scopeType} media`
		: `${scopeType} ${key}`;
}

/**
 * Normalizes a library key.
 *
 * @param key - Optional library key.
 * @returns Non-empty library key.
 */
function normalizeLibraryKey(key: string | null | undefined): string {
	return String(key || MEDIA_LIBRARY_DEFAULT_KEY).trim() || MEDIA_LIBRARY_DEFAULT_KEY;
}

/**
 * Normalizes a MIME type, falling back to the filename extension.
 *
 * @param mimeType - Optional MIME type.
 * @param name - Optional filename.
 * @returns MIME type for storage and metadata.
 */
function normalizeMimeType(mimeType: string | null | undefined, name: string | null | undefined): string {
	const value = String(mimeType || '').trim().toLowerCase();

	if (value) return value;
	if (name) return mimeTypeFromPath(name);

	return 'application/octet-stream';
}

/**
 * Normalizes and validates a MIME type supported by canonical reconstruction.
 *
 * @param value - Source image MIME type supplied by the upload adapter.
 * @returns Normalized reconstructible image MIME type.
 */
function reconstructibleImageMimeType(value: string): string {
	const mimeType = String(value || '').trim().toLowerCase();

	if (!RECONSTRUCTIBLE_IMAGE_MIME_TYPES.has(mimeType)) {
		throw new ImageReconstructionError(
			`Image MIME type "${mimeType || 'unknown'}" cannot be reconstructed.`,
		);
	}

	return mimeType;
}

/**
 * Converts an unknown stream failure into a standard Error instance.
 *
 * @param value - Error-like value emitted by a Node stream.
 * @returns Standard error preserving the available message.
 */
function asError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

/**
 * Normalizes a filename and removes path separators.
 *
 * @param name - Optional requested filename.
 * @param mimeType - MIME type used to choose a fallback extension.
 * @returns Safe display filename.
 */
function normalizeFileName(name: string | null | undefined, mimeType: string | null | undefined): string {
	const value = normalizeOptionalFileName(name);

	if (value) return value;

	return `file${extensionForMimeType(mimeType)}`;
}

/**
 * Normalizes an optional filename and returns null when it is empty.
 *
 * @param name - Optional requested filename.
 * @returns Safe display filename or null.
 */
function normalizeOptionalFileName(name: string | null | undefined): string | null {
	const value = String(name || '').trim().replace(/[\\/]+/g, '-').replace(/\s+/g, ' ');

	return value || null;
}

/**
 * Adds a sequence number before a filename extension when required.
 *
 * @param requestedName - Normalized browser item name requested by the caller.
 * @param sequence - One-based allocation sequence.
 * @returns Original name for sequence one, otherwise a numbered variant.
 */
function numberedMediaItemName(requestedName: string, sequence: number): string {
	if (sequence <= 1) return requestedName;

	const extensionIndex = requestedName.lastIndexOf('.');
	const hasExtension = extensionIndex > 0;
	const stem = hasExtension ? requestedName.slice(0, extensionIndex) : requestedName;
	const extension = hasExtension ? requestedName.slice(extensionIndex) : '';
	const suffix = `-${sequence}`;
	const maximumStemLength = Math.max(1, 255 - extension.length - suffix.length);

	return `${stem.slice(0, maximumStemLength)}${suffix}${extension}`;
}

/**
 * Builds a generated storage path for a managed file.
 *
 * @param library - Media library that owns the file.
 * @param fileId - Generated managed file id.
 * @param name - Safe file name.
 * @returns Storage path relative to the chosen disk.
 */
function defaultFilePath(library: MediaLibrary, fileId: string, name: string): string {
	const prefix = trimSlashes(library.pathPrefix || `media/${requiredString(library.id, 'Media library id is required.')}`);

	return normalizeStoragePath(`${prefix}/${fileId}/${name}`);
}

/**
 * Converts framework storage contents into a byte length.
 *
 * @param contents - Storage contents accepted by the storage service.
 * @returns Byte length for the supplied contents.
 */
function storageContentsByteLength(contents: StorageContents): number {
	if (typeof contents === 'string') return Buffer.byteLength(contents);
	if (Buffer.isBuffer(contents)) return contents.length;
	if (contents instanceof ArrayBuffer) return contents.byteLength;

	return contents.byteLength;
}

/**
 * Removes leading and trailing slashes from a storage path prefix.
 *
 * @param input - Path prefix.
 * @returns Trimmed path prefix.
 */
function trimSlashes(input: string): string {
	return input.replace(/^\/+|\/+$/g, '');
}

/**
 * Returns a conventional extension for common MIME types.
 *
 * @param mimeType - MIME type.
 * @returns File extension including the dot.
 */
function extensionForMimeType(mimeType: string | null | undefined): string {
	switch (mimeType) {
		case 'image/png':
			return '.png';
		case 'image/jpeg':
			return '.jpg';
		case 'image/webp':
			return '.webp';
		case 'application/pdf':
			return '.pdf';
		case 'text/plain':
			return '.txt';
		default:
			return '.bin';
	}
}

/**
 * Normalizes a browser path into a slash-prefixed path.
 *
 * @param value - Browser path-like value.
 * @returns Slash-prefixed browser path.
 */
function normalizeMediaPath(value: string): string {
	const path = String(value || '/').trim();
	const normalized = (path.startsWith('/') ? path : `/${path}`)
		.replace(/\/+/g, '/')
		.replace(/\/$/, '');

	return normalized || '/';
}

/**
 * Joins a media parent path and child name.
 *
 * @param parentPath - Slash-prefixed parent path.
 * @param name - Child display name.
 * @returns Slash-prefixed child path.
 */
function joinMediaPath(parentPath: string, name: string): string {
	const parent = normalizeMediaPath(parentPath);
	const child = String(name || '').trim().replace(/^\/+|\/+$/g, '') || 'Untitled';

	return parent === '/' ? `/${child}` : `${parent}/${child}`;
}

/**
 * Splits a media path into display segments.
 *
 * @param path - Slash-prefixed media path.
 * @returns Path segments without empty entries.
 */
function pathSegments(path: string): string[] {
	return normalizeMediaPath(path).split('/').filter(Boolean);
}

/**
 * Returns a required string value or throws a clear error.
 *
 * @param value - Value to inspect.
 * @param message - Error message when the value is empty.
 * @returns Non-empty string.
 */
function requiredString(value: unknown, message: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(message);
	}

	return value;
}

/**
 * Best-effort cleanup for a storage write that failed after bytes were written.
 *
 * @param disk - Storage disk that may contain the file.
 * @param path - Storage path to remove.
 */
async function deleteStoredFileQuietly(disk: StorageDisk, path: string): Promise<void> {
	try {
		await disk.delete(path);
	} catch {
		// Failed writes should preserve the original error.
	}
}

/**
 * Returns whether a database failure represents a unique-constraint conflict.
 *
 * @param error - Unknown database failure.
 * @returns True for MariaDB, PostgreSQL, or SQLite unique conflicts.
 */
function isUniqueConstraintError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;

	const code = String((error as { code?: unknown }).code ?? '');

	return code === 'ER_DUP_ENTRY'
		|| code === '23505'
		|| code === 'SQLITE_CONSTRAINT'
		|| code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Returns whether a transaction can be retried after concurrent name allocation.
 *
 * MariaDB/MySQL may select one of two simultaneous inserts as a deadlock victim
 * before its unique constraint reports the competing path. PostgreSQL exposes
 * the equivalent deadlock and serialization failures through SQLSTATE codes.
 *
 * @param error - Unknown database failure.
 * @returns True when the current allocation attempt may safely choose another name.
 */
function isRetriableTransactionConflict(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;

	const code = String((error as { code?: unknown }).code ?? '');
	const sqlState = String((error as { sqlState?: unknown }).sqlState ?? '');

	return code === 'ER_LOCK_DEADLOCK'
		|| code === '40P01'
		|| code === '40001'
		|| sqlState === '40P01'
		|| sqlState === '40001';
}
