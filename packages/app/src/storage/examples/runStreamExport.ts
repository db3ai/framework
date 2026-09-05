import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { Storage } from '@db3.ai/app/storage';
import { writeCsvExport } from './writeCsvExport';

/**
 * Exercises streamed file publication, interrupted-write cleanup and retry.
 * @returns Counts and cleanup outcomes without buffering the complete export.
 */
export async function runStreamExport() {
	const root = await mkdtemp(join(tmpdir(), 'db3-stream-guide-'));
	const disk = new Storage({ disks: { local: { driver: 'local', root } } }).disk('local');
	try {
		await writeCsvExport(disk, 'exports/latest.csv', { rows: 50_000 });
		const sizeBefore = await disk.size('exports/latest.csv');
		let interruptionRejected = false;
		try { await writeCsvExport(disk, 'exports/latest.csv', { rows: 10, failAt: 2 }); } catch (error) {
			// Drivers may wrap failures while preserving the original stream error.
			const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
			if (!(cause instanceof Error) || cause.message !== 'Controlled export interruption') throw error;
			interruptionRejected = true;
		}
		const previousPreserved = await disk.size('exports/latest.csv') === sizeBefore;
		const pendingFiles = (await disk.list('pending').toArray()).filter(entry => entry.isFile).length;
		await writeCsvExport(disk, 'exports/repaired.csv', { rows: 3 });
		let lines = 0;
		let bytes = 0;
		const sink = new Writable({
			/** Counts each chunk without retaining the complete file. */
			write(chunk: Buffer, _encoding, callback) { bytes += chunk.length; for (const byte of chunk) if (byte === 10) lines++; callback(); },
		});
		await pipeline(await disk.readStream('exports/latest.csv'), sink);
		return { lines, complete: bytes === sizeBefore, interruptionRejected, previousPreserved, pendingFiles, repaired: await disk.exists('exports/repaired.csv') };
	} finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runStreamExport(), null, 2));
