import type { Knex } from 'knex';
import type { DatabaseDialect } from './types';
import {
	mysqlDialect,
	vectorFromDbValue,
} from './mysql';

/**
 * MariaDB dialect used by the framework database layer.
 */
export const mariaDbDialect: DatabaseDialect = {
	...mysqlDialect,
	name: 'mariadb',
	knexClient: 'mysql2',
	supportsVectorIndexes: true,
	vectorToDbValue: vectorToMariaDbValue,
};

/**
 * Converts app-memory vectors into MariaDB's native VECTOR constructor.
 */
function vectorToMariaDbValue(
	vector: readonly number[],
	db?: Knex,
): unknown {
	const vectorText = JSON.stringify(validateVector(vector));

	if (!db) {
		return vectorText;
	}

	// translates strings like [0.1, -0.5, 0.8] into the little-endian IEEE float sequence of bytes required by the VECTOR data type
	return db.raw('VEC_FromText(?)', [vectorText]);
}

/**
 * Validates a vector before serializing it for MariaDB.
 */
function validateVector(vector: readonly number[]): readonly number[] {
	for (let index = 0; index < vector.length; index += 1) {
		const value = vector[index];

		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(`Vector value at index ${index} must be a finite number.`);
		}
	}

	return vector;
}

export { vectorFromDbValue };
