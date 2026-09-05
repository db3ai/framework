import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { App } from '@db3.ai/app/server';

/**
 * Writes, reads, lists and removes an export on an isolated real local disk.
 *
 * This runnable lab owns its temporary directory, not application storage.
 * The same storage calls can use a configured app().storage in feature code.
 *
 * @returns Stable observations; no temporary absolute path is exposed.
 */
export async function runStorage() {
	const root = await mkdtemp(join(tmpdir(), 'db3-storage-guide-'));
	const application = new App({ storage: { default: 'exports', disks: { exports: { driver: 'local', root } } } });
	try {
		const disk = application.storage.disk('exports');
		await disk.write('reports/latest.json', JSON.stringify({ status: 'ready' }), { mimeType: 'application/json' });
		const report = JSON.parse(await disk.readToString('reports/latest.json'));
		await disk.writeStream('reports/export.csv', Readable.from(['name\n', 'Ada\n']), { mimeType: 'text/csv' });
		const csv = await disk.readToString('reports/export.csv');
		const files = (await disk.list('reports').toArray()).filter(entry => entry.isFile).map(entry => entry.path);
		let traversalRejected = false;
		try { await disk.write('../outside.txt', 'not allowed'); } catch { traversalRejected = true; }
		await disk.delete('reports/latest.json');
		return { report, csv, files, traversalRejected, deleted: await disk.missing('reports/latest.json') };
	} finally {
		try { await application.close(); } finally { await rm(root, { recursive: true, force: true }); }
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runStorage(), null, 2));
}
