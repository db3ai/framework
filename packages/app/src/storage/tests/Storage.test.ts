import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../../server';
import { FlystorageDisk, Storage, type StorageDisk } from '..';

const tempRoots: string[] = [];

/**
 * Creates a temporary storage root for an isolated test.
 *
 * @returns Absolute temporary directory path.
 */
async function tempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'platform-storage-'));

	tempRoots.push(root);

	return root;
}

/**
 * Consumes a readable stream into a UTF-8 string for test assertions.
 *
 * @param stream - Readable stream to consume.
 * @returns Stream contents as UTF-8 text.
 */
async function readStreamToString(stream: Readable): Promise<string> {
	const chunks: Buffer[] = [];

	for await (const chunk of stream) {
		if (typeof chunk === 'string') {
			chunks.push(Buffer.from(chunk));
			continue;
		}

		chunks.push(Buffer.from(chunk));
	}

	return Buffer.concat(chunks).toString('utf8');
}

/**
 * Test stream that represents a large file without allocating its contents.
 *
 * The stream intentionally fails if anything pulls data from it, which proves
 * wrapper-level stream APIs pass the stream object through without buffering it.
 */
class VirtualMultiGigStream extends Readable {
	readonly size = 2 * 1024 * 1024 * 1024;
	readAttempted = false;

	/**
	 * Fails when anything tries to pull bytes from this virtual multi-gig stream.
	 */
	_read(): void {
		this.readAttempted = true;
		this.destroy(new Error('The storage wrapper attempted to buffer a virtual multi-gig stream.'));
	}
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map(root => rm(root, {
		force: true,
		recursive: true,
	})));
});

describe('Storage', () => {
	it('writes and reads files through the configured default local disk', async () => {
		const root = await tempRoot();
		const storage = new Storage({
			default: 'agent',
			disks: {
				agent: {
					driver: 'local',
					root,
				},
			},
		});

		await storage.write('generated-images/example.txt', 'hello storage');

		await expect(storage.exists('generated-images/example.txt')).resolves.toBe(true);
		await expect(storage.missing('generated-images/missing.txt')).resolves.toBe(true);
		await expect(storage.getText('generated-images/example.txt')).resolves.toBe('hello storage');
		await expect(readFile(join(root, 'generated-images/example.txt'), 'utf8')).resolves.toBe('hello storage');
		await storage.put('generated-images/second.txt', 'hello put');
		await expect(storage.getText('generated-images/second.txt')).resolves.toBe('hello put');
	});

	it('writes and reads streams without requiring callers to buffer whole files', async () => {
		const root = await tempRoot();
		const storage = new Storage({
			default: 'agent',
			disks: {
				agent: {
					driver: 'local',
					root,
				},
			},
		});

		await storage.writeStream(
			'uploads/large.txt',
			Readable.from(['hello ', Buffer.from('stream')]),
			{
				mimeType: 'text/plain',
			},
		);

		await expect(readFile(join(root, 'uploads/large.txt'), 'utf8')).resolves.toBe('hello stream');
		await expect(readStreamToString(await storage.read('uploads/large.txt'))).resolves.toBe('hello stream');
		await expect(readStreamToString(await storage.readStream('uploads/large.txt'))).resolves.toBe('hello stream');
		await expect(storage.readToString('uploads/large.txt')).resolves.toBe('hello stream');
		await expect(storage.readToBuffer('uploads/large.txt')).resolves.toEqual(Buffer.from('hello stream'));
		await expect(storage.readToUint8Array('uploads/large.txt')).resolves.toEqual(new Uint8Array(Buffer.from('hello stream')));
	});

	it('lists local disk contents lazily with shallow and deep traversal', async () => {
		const root = await tempRoot();
		const storage = new Storage({
			disks: {
				local: {
					driver: 'local',
					root,
				},
			},
		});

		await storage.put('reports/current.json', '{}');
		await storage.put('reports/archive/previous.json', '{"archived":true}');
		await storage.put('readme.txt', 'hello');

		const shallow = await storage.list('reports').toArray();
		const deep = await storage.list('', {
			deep: true,
		}).toArray();

		expect(shallow.map(entry => [entry.type, entry.path])).toEqual([
			['directory', 'reports/archive'],
			['file', 'reports/current.json'],
		]);
		expect(deep.map(entry => [entry.type, entry.path])).toEqual([
			['file', 'readme.txt'],
			['directory', 'reports'],
			['directory', 'reports/archive'],
			['file', 'reports/archive/previous.json'],
			['file', 'reports/current.json'],
		]);
		expect(deep.find(entry => entry.path === 'reports/current.json')).toMatchObject({
			type: 'file',
			path: 'reports/current.json',
		});
		await expect(storage.size('reports/current.json')).resolves.toBe(2);
		expect(await storage.lastModified('reports/current.json')).toBeInstanceOf(Date);
	});

	it('passes multi-gig streams through without buffering them in the wrapper', async () => {
		const uploadStream = new VirtualMultiGigStream();
		const downloadStream = new VirtualMultiGigStream();
		const writes: Array<{
			path: string;
			contents: unknown;
		}> = [];
		const reads: string[] = [];
		const disk = new FlystorageDisk('large-files', {
			async write(path: string, contents: unknown) {
				writes.push({
					path,
					contents,
				});
			},
			async read(path: string) {
				reads.push(path);

				return downloadStream;
			},
		} as unknown as ConstructorParameters<typeof FlystorageDisk>[1]);

		await disk.writeStream('uploads/big-video.bin', uploadStream, {
			mimeType: 'application/octet-stream',
		});
		const stream = await disk.read('uploads/big-video.bin');

		expect(writes).toEqual([
			{
				path: 'uploads/big-video.bin',
				contents: uploadStream,
			},
		]);
		expect(reads).toEqual(['uploads/big-video.bin']);
		expect(stream).toBe(downloadStream);
		expect(uploadStream.readAttempted).toBe(false);
		expect(downloadStream.readAttempted).toBe(false);
	});

	it('writes binary files to a named disk and exposes file metadata helpers', async () => {
		const root = await tempRoot();
		const storage = new Storage({
			default: 'local',
			disks: {
				agent: {
					driver: 'local',
					root,
					url: 'https://cdn.example.test/agent',
				},
			},
		});
		const disk = storage.disk('agent');

		await disk.put('images/photo.png', Buffer.from([1, 2, 3]));

		await expect(disk.get('images/photo.png')).resolves.toEqual(Buffer.from([1, 2, 3]));
		await expect(disk.size('images/photo.png')).resolves.toBe(3);
		await expect(disk.mimeType('images/photo.png')).resolves.toBe('image/png');
		await expect(disk.url('images/photo.png')).resolves.toBe('https://cdn.example.test/agent/images/photo.png');
		expect(disk.path('images/photo.png')).toBe(join(root, 'images/photo.png'));
		expect(await disk.lastModified('images/photo.png')).toBeInstanceOf(Date);
	});

	it('creates S3-compatible disks with public URLs and prefixes', async () => {
		const storage = new Storage({
			disks: {
				spaces: {
					driver: 's3',
					bucket: 'example-assets',
					region: 'nyc3',
					endpoint: 'https://nyc3.digitaloceanspaces.com',
					url: 'https://example-assets.nyc3.digitaloceanspaces.com',
					prefix: '/uploads/',
					accessKeyId: 'spaces-key',
					secretAccessKey: 'spaces-secret',
				},
				aws: {
					driver: 's3',
					bucket: 'platform-assets',
					region: 'eu-west-2',
				},
			},
		});

		await expect(storage.disk('spaces').url('images/header image.png')).resolves.toBe(
			'https://example-assets.nyc3.digitaloceanspaces.com/uploads/images/header%20image.png',
		);
		await expect(storage.disk('aws').url('images/header.png')).resolves.toBe(
			'https://platform-assets.s3.amazonaws.com/images/header.png',
		);
		expect(() => storage.disk('spaces').path('images/header.png')).toThrow('does not expose local filesystem paths');
	});

	it('validates S3 disk configuration', () => {
		expect(() => new Storage({
			disks: {
				s3: {
					driver: 's3',
					bucket: '',
				},
			},
		}).disk('s3')).toThrow('S3 storage disk requires a bucket.');

		expect(() => new Storage({
			disks: {
				s3: {
					driver: 's3',
					bucket: 'platform-assets',
					accessKeyId: 'key-only',
				},
			},
		}).disk('s3')).toThrow('requires both accessKeyId and secretAccessKey');
	});

	it('copies, moves, and deletes files on a disk', async () => {
		const root = await tempRoot();
		const storage = new Storage({
			disks: {
				local: {
					driver: 'local',
					root,
				},
			},
		});

		await storage.put('one.txt', 'first');
		await storage.copy('one.txt', 'nested/two.txt');
		await storage.move('nested/two.txt', 'three.txt');

		await expect(storage.getText('one.txt')).resolves.toBe('first');
		await expect(storage.exists('nested/two.txt')).resolves.toBe(false);
		await expect(storage.getText('three.txt')).resolves.toBe('first');
		await expect(storage.delete('three.txt')).resolves.toBe(true);
		await expect(storage.delete('three.txt')).resolves.toBe(false);
	});

	it('rejects paths that leave the disk root', async () => {
		const root = await tempRoot();
		const storage = new Storage({
			disks: {
				local: {
					driver: 'local',
					root,
				},
			},
		});

		await expect(storage.put('../outside.txt', 'nope')).rejects.toThrow('cannot leave the storage disk root');
		await expect(storage.put('/absolute.txt', 'nope')).rejects.toThrow('must be relative');
		await expect(storage.put('', 'nope')).rejects.toThrow('cannot be empty');
	});

	it('caches disks and exposes drive as a disk alias', async () => {
		const root = await tempRoot();
		const storage = new Storage({
			disks: {
				local: {
					driver: 'local',
					root,
				},
			},
		});

		expect(storage.disk()).toBe(storage.disk('local'));
		expect(storage.drive('local')).toBe(storage.disk('local'));
	});

	it('supports custom driver factories', async () => {
		const writes: Array<{ path: string; contents: string }> = [];
		const storage = new Storage({
			default: 'memory',
			disks: {
				memory: {
					driver: 'memory',
				},
			},
			drivers: {
				memory(name): StorageDisk {
					return {
						name,
						list() {
							return {
								async *[Symbol.asyncIterator]() {},
								async toArray() {
									return [];
								},
							};
						},
						async write(path, contents) {
							writes.push({
								path,
								contents: Buffer.isBuffer(contents) ? contents.toString('utf8') : String(contents),
							});
						},
						async put(path, contents) {
							writes.push({
								path,
								contents: Buffer.isBuffer(contents) ? contents.toString('utf8') : String(contents),
							});
						},
						async writeStream(path, stream) {
							writes.push({
								path,
								contents: await readStreamToString(stream),
							});
						},
						async get() {
							return Buffer.from('memory');
						},
						async readToString() {
							return 'memory';
						},
						async readToBuffer() {
							return Buffer.from('memory');
						},
						async readToUint8Array() {
							return new Uint8Array(Buffer.from('memory'));
						},
						async read() {
							return Readable.from(['memory']);
						},
						async readStream() {
							return Readable.from(['memory']);
						},
						async getText() {
							return 'memory';
						},
						async exists() {
							return true;
						},
						async missing() {
							return false;
						},
						async delete() {
							return true;
						},
						async copy() {},
						async move() {},
						async size() {
							return 6;
						},
						async lastModified() {
							return new Date(0);
						},
						async mimeType() {
							return 'text/plain';
						},
						async url(path) {
							return `memory://${path}`;
						},
						path(path) {
							return path;
						},
					};
				},
			},
		});

		await storage.put('example.txt', 'custom');

		expect(writes).toEqual([
			{
				path: 'example.txt',
				contents: 'custom',
			},
		]);
		await expect(storage.getText('example.txt')).resolves.toBe('memory');
	});

	it('allows app.storage to be configured through the app service hub', async () => {
		const root = await tempRoot();
		const app = new App({
			storage: {
				default: 'agent',
				disks: {
					agent: {
						driver: 'local',
						root,
					},
				},
			},
		});

		await app.storage.disk('agent').put('hello.txt', 'from app');

		expect(app.storage).toBe(app.storage);
		await expect(app.storage.getText('hello.txt')).resolves.toBe('from app');
	});

	it('reports unknown disks and drivers clearly', () => {
		const storage = new Storage({
			disks: {
				remote: {
					driver: 'ftp',
				},
			},
		});

		expect(() => storage.disk('missing')).toThrow('Storage disk "missing" is not configured.');
		expect(() => storage.disk('remote')).toThrow('Storage driver "ftp" is not registered.');
	});
});
