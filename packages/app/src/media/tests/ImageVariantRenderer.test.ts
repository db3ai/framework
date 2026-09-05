import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Transform, type Readable } from 'node:stream';

import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { ImageVariantRenderer, type ImageProcessor, type ImageProcessorCommand, type ImageProcessorReconstructionCommand, MediaFile, MediaLibrary, MediaManager } from '..';
import { Storage } from '../../storage';

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map(root => rm(root, {
		force: true,
		recursive: true,
	})));
});

describe('ImageVariantRenderer', () => {
	it('streams responsive images into durable storage and reuses the cached variant', async () => {
		const { media, storage } = await createImageRenderer();
		const source = await sharp({
			create: {
				width: 1200,
				height: 600,
				channels: 3,
				background: '#4466aa',
			},
		})
			.jpeg({
				quality: 90,
			})
			.toBuffer();
		const file = managedImageFile(source.length);

		await storage.disk('local').put(file.path || '', source, {
			mimeType: 'image/jpeg',
			visibility: 'public',
		});

		const [first, concurrent] = await Promise.all([
			media.renderImage(file, {
				width: 300,
			}),
			media.renderImage(file, {
				width: 300,
			}),
		]);
		const firstBytes = await streamBuffer(first.stream);
		const concurrentBytes = await streamBuffer(concurrent.stream);
		const metadata = await sharp(firstBytes).metadata();
		const cached = await media.renderImage(file, {
			width: 300,
		});
		const cachedBytes = await streamBuffer(cached.stream);

		expect(metadata.width).toBe(300);
		expect(metadata.height).toBe(150);
		expect(metadata.format).toBe('webp');
		expect(first.mimeType).toBe('image/webp');
		expect(first.path).toBe('image-cache/v1/01K123456789ABCDEFGHJKMNR1/w-300.webp');
		expect(concurrent.path).toBe(first.path);
		expect([first.cached, concurrent.cached].sort()).toEqual([false, true]);
		expect(cached.cached).toBe(true);
		expect(cachedBytes).toEqual(firstBytes);
		expect(concurrentBytes).toEqual(firstBytes);
		await expect(storage.disk('local').exists(first.path || '')).resolves.toBe(false);
		await expect(storage.disk('tmp').exists(first.path || '')).resolves.toBe(true);
	});

	it('rejects invalid widths before opening the source image', async () => {
		const { media } = await createImageRenderer();
		const file = managedImageFile(1);

		await expect(media.renderImage(file, {
			width: 0,
		})).rejects.toThrow('Image width must be an integer between 1 and 4096.');
	});

	it('rejects a missing source without crashing the image process', async () => {
		const { media, storage } = await createImageRenderer();
		const file = managedImageFile(1);
		const variantPath = 'image-cache/v1/01K123456789ABCDEFGHJKMNR1/w-300.webp';

		await expect(media.renderImage(file, {
			width: 300,
		})).rejects.toThrow();
		await expect(storage.disk('tmp').exists(variantPath)).resolves.toBe(false);
	});

	it('compresses the original dimensions when width is omitted', async () => {
		const { media, storage } = await createImageRenderer();
		const source = await sharp({
			create: {
				width: 800,
				height: 400,
				channels: 3,
				background: '#aa6644',
			},
		})
			.png()
			.toBuffer();
		const file = managedImageFile(source.length, {
			mimeType: 'image/png',
			name: 'source.png',
			path: 'media/01K123456789ABCDEFGHJKMNR1/source.png',
		});

		await storage.disk('local').put(file.path || '', source, {
			mimeType: 'image/png',
			visibility: 'public',
		});

		const compressed = await media.renderImage(file, {});
		const compressedBytes = await streamBuffer(compressed.stream);
		const metadata = await sharp(compressedBytes).metadata();

		expect(metadata.width).toBe(800);
		expect(metadata.height).toBe(400);
		expect(metadata.format).toBe('webp');
		expect(compressed.mimeType).toBe('image/webp');
		expect(compressed.path).toBe('image-cache/v1/01K123456789ABCDEFGHJKMNR1/original.webp');
		await expect(storage.disk('tmp').exists(compressed.path || '')).resolves.toBe(true);
	});

	it('regenerates variants after the complete temporary directory is deleted', async () => {
		const { cacheRoot, media, storage } = await createImageRenderer();
		const source = await sharp({
			create: {
				width: 600,
				height: 300,
				channels: 3,
				background: '#226644',
			},
		})
			.jpeg()
			.toBuffer();
		const file = managedImageFile(source.length);

		await storage.disk('local').put(file.path || '', source, {
			mimeType: 'image/jpeg',
			visibility: 'public',
		});

		const first = await media.renderImage(file, {
			width: 300,
		});
		const firstBytes = await streamBuffer(first.stream);

		await rm(cacheRoot, {
			force: true,
			recursive: true,
		});

		await expect(storage.disk('local').exists(file.path || '')).resolves.toBe(true);

		const regenerated = await media.renderImage(file, {
			width: 300,
		});
		const regeneratedBytes = await streamBuffer(regenerated.stream);

		expect(regenerated.cached).toBe(false);
		expect(regenerated.path).toBe(first.path);
		expect(regeneratedBytes).toEqual(firstBytes);
		await expect(storage.disk('tmp').exists(regenerated.path || '')).resolves.toBe(true);
	});

	it('limits concurrent cache-generating processor work', async () => {
		const { storage } = await createImageRenderer();
		const processor = new TrackingImageProcessor();
		const renderer = new ImageVariantRenderer(storage, {
			cacheDisk: 'tmp',
			cachePrefix: 'image-cache',
		}, processor);
		const file = managedImageFile(12);

		await storage.disk('local').put(file.path || '', Buffer.from('image-source'), {
			mimeType: 'image/jpeg',
			visibility: 'public',
		});

		const variants = await Promise.all([
			renderer.render(file, {
				width: 100,
			}),
			renderer.render(file, {
				width: 200,
			}),
			renderer.render(file, {
				width: 300,
			}),
		]);

		expect(processor.maximumActive).toBe(2);
		variants.forEach(variant => variant.stream.destroy());
	});
});

/**
 * Test processor that records concurrent transforms while passing bytes through.
 */
class TrackingImageProcessor implements ImageProcessor {
	/** Number of transforms currently processing source bytes. */
	#active = 0;

	/** Highest number of transforms observed at the same time. */
	maximumActive = 0;

	/**
	 * Creates a deliberately delayed passthrough transform.
	 *
	 * @param command - Validated framework command.
	 * @returns Transform used to observe renderer concurrency.
	 */
	transform(command: ImageProcessorCommand): Transform {
		void command;
		this.#active += 1;
		this.maximumActive = Math.max(this.maximumActive, this.#active);

		return new Transform({
			transform: (chunk, encoding, callback) => {
				void encoding;
				setTimeout(() => {
					callback(null, chunk);
				}, 20);
			},
			flush: callback => {
				this.#active -= 1;
				callback();
			},
		});
	}

	/**
	 * Creates a passthrough reconstruction for interface completeness.
	 *
	 * @param command - Validated framework reconstruction command.
	 * @returns Transform that passes reconstructed test bytes through unchanged.
	 */
	reconstruct(command: ImageProcessorReconstructionCommand): Transform {
		void command;

		return new Transform({
			transform: (chunk, encoding, callback) => {
				void encoding;
				callback(null, chunk);
			},
		});
	}
}

/**
 * Creates an isolated media renderer backed by a temporary local disk.
 *
 * @returns Media manager and storage service for one test.
 */
async function createImageRenderer(): Promise<{
	cacheRoot: string;
	media: MediaManager;
	storage: Storage;
}> {
	const sourceRoot = await mkdtemp(join(tmpdir(), 'platform-image-source-'));
	const cacheRoot = await mkdtemp(join(tmpdir(), 'platform-image-cache-'));
	const storage = new Storage({
		default: 'local',
		disks: {
			local: {
				driver: 'local',
				root: sourceRoot,
			},
			tmp: {
				driver: 'local',
				root: cacheRoot,
				visibility: 'private',
			},
		},
	});

	tempRoots.push(sourceRoot, cacheRoot);

	return {
		cacheRoot,
		media: new MediaManager(storage, {
			images: {
				cacheDisk: 'tmp',
				cachePrefix: 'image-cache',
			},
		}),
		storage,
	};
}

/**
 * Creates a persisted managed image row without requiring a database.
 *
 * @param size - Encoded source byte size.
 * @param overrides - Optional managed file fields for the test source.
 * @returns Managed image file row.
 */
function managedImageFile(size: number, overrides: Partial<MediaFile> = {}): MediaFile {
	const library = new MediaLibrary({
		id: '01K123456789ABCDEFGHJKMNR2',
		scopeType: 'test.scope',
		scopeId: 'image-renderer',
		key: 'default',
		name: 'Image renderer',
	}, {
		persisted: true,
	});

	return new MediaFile({
		id: '01K123456789ABCDEFGHJKMNR1',
		library,
		disk: 'local',
		path: 'media/01K123456789ABCDEFGHJKMNR1/source.jpg',
		name: 'source.jpg',
		mimeType: 'image/jpeg',
		size,
		visibility: 'public',
		source: 'test',
		...overrides,
	}, {
		persisted: true,
	});
}

/**
 * Collects a test response stream into a buffer.
 *
 * Production image delivery keeps the stream unbuffered; tests collect it only
 * so encoded dimensions and byte equality can be asserted.
 *
 * @param stream - Readable image stream.
 * @returns Complete encoded image bytes.
 */
async function streamBuffer(stream: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];

	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}

	return Buffer.concat(chunks);
}
