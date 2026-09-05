import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { MediaFile, MediaItem, MediaLibrary } from '@db3.ai/app/media';
import { App } from '@db3.ai/app/server';

/**
 * Stores a project brief, makes a browser placement and proves library isolation.
 *
 * The project identity is trusted lab input. Real endpoints must authorize the
 * project before resolving its library, and scope file reads to that library.
 *
 * @returns Stable results after removing the lab's database and temporary files.
 */
export async function runProjectMedia() {
	const root = await mkdtemp(join(tmpdir(), 'db3-media-guide-'));
	try {
		const database = await createGeneratedTestDatabase('media_guide');
		const application = new App({ db: database.db, storage: { disks: { local: { driver: 'local', root } } } });
		try {
			await application.db.install(MediaLibrary, MediaFile, MediaItem);
			const library = await application.media.libraryFor({ scopeType: 'project', scopeId: 'client-a', name: 'Client files', pathPrefix: 'projects/client-a' });
			const otherLibrary = await application.media.libraryFor({ scopeType: 'project', scopeId: 'client-b' });
			const stored = await application.media.storeVisibleFileStream({ library, name: 'brief.txt', stream: Readable.from(['Client brief']), mimeType: 'text/plain', folderPath: '/Briefs', source: 'upload' });
			const duplicate = await application.media.storeVisibleFile({ library, name: 'brief.txt', contents: 'Revised brief', mimeType: 'text/plain', folderPath: '/Briefs' });
			const file = await MediaFile.where({ id: stored.file.id, library }).firstOrFail();
			const text = (await application.media.readFile(file)).toString('utf8');
			const crossProjectRejected = await MediaFile.where({ id: file.id, library: otherLibrary }).first() === null;
			const result = { text, path: stored.item.path, duplicatePath: duplicate.item.path, private: file.visibility === 'private', crossProjectRejected };
			const originalPath = file.path!;
			await application.media.deleteFile(file);
			return { ...result, deleted: await application.storage.missing(originalPath), placementRemoved: await MediaItem.where('id', stored.item.id).first() === null };
		} finally {
			try { await application.close(); } finally { await database.destroy(); }
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runProjectMedia(), null, 2));
}
