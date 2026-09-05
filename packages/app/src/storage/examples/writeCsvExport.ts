import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { StorageDisk } from '@db3.ai/app/storage';

/** Options for a bounded-memory CSV export and deliberate failure in the lab. */
export interface CsvExportOptions {
	/** Number of synthetic rows to generate without retaining all rows in memory. */
	rows: number;
	/** Lab-only failure point; omit for a normal export. */
	failAt?: number;
}

/**
 * Streams a generated CSV to a staging path, publishing only after success.
 *
 * The staging path is owned by this operation. A failed stream removes that
 * object and leaves the previous destination untouched. Cross-provider moves
 * are not assumed atomic; concurrent publication needs an application policy.
 *
 * @param disk - Application-owned disk selected before the operation.
 * @param destination - Authorized relative output path, not raw request input.
 * @param options - Row count and optional controlled failure point.
 */
export async function writeCsvExport(disk: StorageDisk, destination: string, options: CsvExportOptions): Promise<void> {
	if (!Number.isInteger(options.rows) || options.rows < 0 || options.rows > 1_000_000) throw new Error('rows must be an integer between 0 and 1000000');
	const staging = `pending/${randomUUID()}.csv`;
	const stream = Readable.from(csvRows(options));
	try {
		await disk.writeStream(staging, stream, { mimeType: 'text/csv', visibility: 'private' });
		await disk.move(staging, destination);
	} catch (error) {
		stream.destroy();
		if (await disk.exists(staging)) await disk.delete(staging);
		throw error;
	}
}

/** Produces one safe synthetic CSV row at a time; real exports must escape data. */
function* csvRows(options: CsvExportOptions): Generator<string> {
	yield 'id,value\n';
	for (let index = 0; index < options.rows; index++) {
		if (index === options.failAt) throw new Error('Controlled export interruption');
		yield `${index},note-${index}\n`;
	}
}
