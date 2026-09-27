import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import {
	afterEach,
	describe,
	expect,
	it,
} from 'vitest';
import { Database } from '../../db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../db/test/db';
import { MediaFile, MediaItem, MediaLibrary } from '@db3.ai/app/media';
import { App } from '../../server';

const tempRoots: string[] = [];
const databases: GeneratedTestDatabase[] = [];
const apps: App[] = [];

afterEach(async () => {
	await Promise.all(apps.splice(0).map(app => app.close()));
	await Promise.all(tempRoots.splice(0).map(root => rm(root, {
		force: true,
		recursive: true,
	})));
	await Promise.all(databases.splice(0).map(database => database.destroy()));
});

describe('MediaManager', () => {
	it('finds or creates one library for each scope and key', async () => {
		const { app } = await createMediaTestApp('library_scope');

		const first = await app.media.libraryFor({
			scopeType: 'test.scope',
			scopeId: 'scope-one',
			key: 'default',
			name: 'Default media',
		});
		const second = await app.media.libraryFor({
			scopeType: 'test.scope',
			scopeId: 'scope-one',
			key: 'default',
			name: 'Changed name',
		});
		const reference = await app.media.libraryFor({
			scopeType: 'test.scope',
			scopeId: 'scope-one',
			key: 'reference-material',
			name: 'Reference material',
		});

		expect(second.id).toBe(first.id);
		expect(second.name).toBe('Default media');
		expect(reference.id).not.toBe(first.id);
		expect(reference.key).toBe('reference-material');
	});

	it('shares one library and folder tree between concurrent first uploads', async () => {
		const { app } = await createMediaTestApp('concurrent_library');
		const libraries = await Promise.all(Array.from({ length: 5 }, () => app.media.libraryFor({ scopeType: 'test.concurrent', scopeId: 'one', name: 'Shared' })));
		expect(new Set(libraries.map(library => library.id)).size).toBe(1);
		const stored = await Promise.all(libraries.map(library => app.media.storeVisibleFile({ library, folderPath: '/Generated images/Nested', name: 'image.txt', contents: Buffer.from('synthetic image'), mimeType: 'text/plain' })));
		expect(new Set(stored.map(file => file.file.id)).size).toBe(5);
		expect(new Set(stored.map(file => file.item.path)).size).toBe(5);
		expect(await MediaLibrary.where('scopeType', 'test.concurrent').count()).toBe(1);
		for (const path of ['/', '/Generated images', '/Generated images/Nested']) {
			expect(await MediaItem.where({ library: libraries[0]!, path }).count()).toBe(1);
		}
	});

	it('stores managed files without creating browser items', async () => {
		const { app, root } = await createMediaTestApp('hidden_file');
		const library = await app.media.libraryFor({
			scopeType: 'test.scope',
			scopeId: 'hidden-file',
			name: 'Hidden file media',
			pathPrefix: 'scopes/hidden-file/media',
		});

		const file = await app.media.storeFile({
			library,
			contents: Buffer.from('managed bytes'),
			name: 'private-export.txt',
			mimeType: 'text/plain',
			source: 'export',
			meta: {
				visible: false,
			},
		});

		const fileCount = await app.db.knex(MediaFile.table).count<{ count: string }>({ count: '*' }).first();
		const itemCount = await app.db.knex(MediaItem.table).count<{ count: string }>({ count: '*' }).first();

		expect(file.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(file.path).toBe(`scopes/hidden-file/media/${file.id}/private-export.txt`);
		expect(file.size).toBe(13);
		expect(Number(fileCount?.count ?? 0)).toBe(1);
		expect(Number(itemCount?.count ?? 0)).toBe(0);
		await expect(app.media.readFile(file)).resolves.toEqual(Buffer.from('managed bytes'));
		await expect(app.storage.getText(`scopes/hidden-file/media/${file.id}/private-export.txt`)).resolves.toBe('managed bytes');
		expect(app.storage.path(file.path || '')).toBe(join(root, `scopes/hidden-file/media/${file.id}/private-export.txt`));
	});

	it('stores visible files under folders while preserving file lookup by ULID', async () => {
		const { app } = await createMediaTestApp('visible_file');
		const library = await app.media.libraryFor({
			scopeType: 'test.scope',
			scopeId: 'visible-file',
			name: 'Visible file media',
		});

		const stored = await app.media.storeVisibleFile({
			library,
			contents: Buffer.from([1, 2, 3]),
			name: 'developer-testing-accessible-dialog.png',
			mimeType: 'image/png',
			source: 'generated-image',
			folderPath: '/Generated images/Articles/agency seo software',
			meta: {
				model: 'gpt-image-2',
			},
		});
		const rows = await MediaItem
			.where('library', library)
			.orderBy('path')
			.all();

		expect(stored.file.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(stored.file.name).toBe('developer-testing-accessible-dialog.png');
		expect(stored.item.file?.id).toBe(stored.file.id);
		expect(stored.item.name).toBe('developer-testing-accessible-dialog.png');
		expect(stored.item.path).toBe('/Generated images/Articles/agency seo software/developer-testing-accessible-dialog.png');
		expect(rows.map(row => row.path)).toEqual([
			'/',
			'/Generated images',
			'/Generated images/Articles',
			'/Generated images/Articles/agency seo software',
			'/Generated images/Articles/agency seo software/developer-testing-accessible-dialog.png',
		]);
		await expect(app.media.readFile(stored.file.id || '')).resolves.toEqual(Buffer.from([1, 2, 3]));
	});

	it('streams completed uploads into managed media without buffering the file', async () => {
		const { app } = await createMediaTestApp('streamed_file');
		const library = await app.media.libraryFor({
			scopeType: 'test.scope',
			scopeId: 'streamed-file',
			name: 'Streamed file media',
		});
		const bytes = Buffer.from('streamed upload bytes');
		const stored = await app.media.storeVisibleFileStream({
			library,
			stream: Readable.from([bytes.subarray(0, 8), bytes.subarray(8)]),
			name: 'resumable-upload.txt',
			mimeType: 'text/plain',
			size: bytes.length,
			source: 'upload',
			folderPath: '/Uploads',
		});

		expect(stored.file.size).toBe(bytes.length);
		expect(stored.file.source).toBe('upload');
		expect(stored.item.path).toBe('/Uploads/resumable-upload.txt');
		await expect(app.media.readFile(stored.file)).resolves.toEqual(bytes);
	});

	it('numbers duplicate browser filenames while preserving distinct file ULIDs', async () => {
		const { app } = await createMediaTestApp('duplicate_visible_names');
		const library = await app.media.libraryFor({
			scopeType: 'test.scope',
			scopeId: 'duplicate-visible-names',
			name: 'Duplicate visible names',
		});

		await app.media.rootFor(library);

		const [first, second] = await Promise.all([
			app.media.storeVisibleFile({
				library,
				contents: Buffer.from('first moon'),
				name: 'moon.png',
				mimeType: 'image/png',
			}),
			app.media.storeVisibleFile({
				library,
				contents: Buffer.from('second moon'),
				name: 'moon.png',
				mimeType: 'image/png',
			}),
		]);
		const third = await app.media.storeVisibleFile({
			library,
			contents: Buffer.from('third moon'),
			name: 'moon.png',
			mimeType: 'image/png',
		});
		const items = await MediaItem
			.where('library', library)
			.where('type', 'file')
			.orderBy('path')
			.all();

		expect(new Set([first.file.id, second.file.id, third.file.id]).size).toBe(3);
		expect(items.map(item => item.name)).toEqual([
			'moon-2.png',
			'moon-3.png',
			'moon.png',
		]);
		expect(items.map(item => item.path)).toEqual([
			'/moon-2.png',
			'/moon-3.png',
			'/moon.png',
		]);
		expect([first.file.name, second.file.name, third.file.name]).toEqual([
			'moon.png',
			'moon.png',
			'moon.png',
		]);
	});

	it('deletes managed source bytes, cached variants, and browser placements', async () => {
		const { app } = await createMediaTestApp('delete_visible_file');
		const library = await app.media.libraryFor({
			scopeType: 'test.scope',
			scopeId: 'delete-visible-file',
			name: 'Delete visible file media',
		});
		const stored = await app.media.storeVisibleFile({
			library,
			contents: Buffer.from('image bytes'),
			name: 'old-article-image.png',
			mimeType: 'image/png',
			visibility: 'public',
		});
		const uncached = await app.media.storeVisibleFile({
			library,
			contents: Buffer.from('uncached image bytes'),
			name: 'uncached-image.png',
			mimeType: 'image/png',
			visibility: 'public',
		});
		const fileId = stored.file.id || '';
		const sourcePath = stored.file.path || '';
		const uncachedFileId = uncached.file.id || '';
		const uncachedSourcePath = uncached.file.path || '';
		const variantPath = `image-cache/v1/${fileId}/w-640.webp`;

		await app.storage.put(variantPath, Buffer.from('cached variant'));
		await app.media.deleteFile(stored.file);
		await expect(app.media.deleteFile(uncached.file)).resolves.toBeUndefined();

		await expect(MediaFile.find(fileId)).resolves.toBeNull();
		await expect(MediaFile.find(uncachedFileId)).resolves.toBeNull();
		await expect(MediaItem.where('file', fileId).all()).resolves.toEqual([]);
		await expect(MediaItem.where('file', uncachedFileId).all()).resolves.toEqual([]);
		await expect(app.storage.exists(sourcePath)).resolves.toBe(false);
		await expect(app.storage.exists(uncachedSourcePath)).resolves.toBe(false);
		await expect(app.storage.exists(variantPath)).resolves.toBe(false);
	});
});

/**
 * Creates an app with isolated database tables and a temporary storage root.
 *
 * @param label - Test database label.
 * @returns App, database, and storage root for one test.
 */
async function createMediaTestApp(label: string): Promise<{
	app: App;
	database: GeneratedTestDatabase;
	root: string;
}> {
	const database = await createGeneratedTestDatabase(`media_${label}`);
	const root = await mkdtemp(join(tmpdir(), 'platform-media-'));
	const app = new App({
		db: database.db,
		storage: {
			default: 'local',
			disks: {
				local: {
					driver: 'local',
					root,
				},
			},
		},
	});

	databases.push(database);
	tempRoots.push(root);
	apps.push(app);
	await new Database(database.db, {
		reportSchemaDiff: false,
	}).install(
		MediaLibrary,
		MediaFile,
		MediaItem,
	);

	return {
		app,
		database,
		root,
	};
}
