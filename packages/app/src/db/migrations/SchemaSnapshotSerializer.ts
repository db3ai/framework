import { createHash } from 'node:crypto';
import type { DatabaseDialectName } from '../dialects';
import type { SchemaSnapshot } from './contracts';

/**
 * Creates an empty normalized snapshot for an application with no models.
 *
 * @param dialect - Database dialect represented by the snapshot.
 * @returns Empty schema snapshot suitable as the first diff baseline.
 */
export function emptySchemaSnapshot(dialect: DatabaseDialectName): SchemaSnapshot {
	return {
		formatVersion: 1,
		dialect,
		tables: [],
	};
}

/**
 * Serializes a normalized snapshot in the committed human-readable format.
 *
 * @param snapshot - Normalized schema snapshot.
 * @returns Deterministic JSON document ending with one newline.
 */
export function serializeSchemaSnapshot(snapshot: SchemaSnapshot): string {
	return `${JSON.stringify(snapshot, null, '\t')}\n`;
}

/**
 * Parses and minimally validates a committed schema snapshot.
 *
 * @param input - JSON text read from the application snapshot file.
 * @returns Parsed version-one schema snapshot.
 */
export function parseSchemaSnapshot(input: string): SchemaSnapshot {
	const value = JSON.parse(input) as Partial<SchemaSnapshot>;

	if (
		value.formatVersion !== 1
		|| typeof value.dialect !== 'string'
		|| !Array.isArray(value.tables)
	) {
		throw new Error('Database schema snapshot is not a supported version-one snapshot.');
	}

	return value as SchemaSnapshot;
}

/**
 * Produces a stable content hash for migration lineage and comparisons.
 *
 * @param snapshot - Normalized schema snapshot.
 * @returns Lower-case SHA-256 digest.
 */
export function hashSchemaSnapshot(snapshot: SchemaSnapshot): string {
	return createHash('sha256')
		.update(JSON.stringify(snapshot))
		.digest('hex');
}
