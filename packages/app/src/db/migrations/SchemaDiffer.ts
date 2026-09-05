import { isDeepStrictEqual } from 'node:util';
import type {
	BlockedSchemaChange,
	SafeSchemaChange,
	SchemaColumn,
	SchemaForeignKey,
	SchemaIndex,
	SchemaMigrationPlan,
	SchemaSnapshot,
	SchemaTable,
} from './contracts';
import { hashSchemaSnapshot } from './SchemaSnapshotSerializer';

/**
 * Computes a pure deterministic migration plan between two normalized schema
 * snapshots.
 *
 * The automatic policy is intentionally conservative. Any blocked change
 * prevents the manager from emitting a partially correct migration.
 *
 * @param from - Previously committed or currently installed model-owned state.
 * @param to - New desired model-owned state.
 * @returns Safe renderable changes and blocked reviewed changes.
 */
export function diffSchemaSnapshots(
	from: SchemaSnapshot,
	to: SchemaSnapshot,
): SchemaMigrationPlan {
	if (from.dialect !== to.dialect) {
		throw new Error(
			`Cannot diff ${from.dialect} schema against ${to.dialect} schema.`,
		);
	}

	const safeChanges: SafeSchemaChange[] = [];
	const blockedChanges: BlockedSchemaChange[] = [];
	const fromTables = mapByName(from.tables);
	const toTables = mapByName(to.tables);
	const tableNames = [...new Set([
		...fromTables.keys(),
		...toTables.keys(),
	])].sort();

	for (const tableName of tableNames) {
		const oldTable = fromTables.get(tableName);
		const newTable = toTables.get(tableName);

		if (!oldTable && newTable) {
			safeChanges.push({
				kind: 'create_table',
				table: newTable,
				description: `Create table ${tableName}.`,
			});
			continue;
		}

		if (oldTable && !newTable) {
			blockedChanges.push({
				kind: 'blocked_change',
				operation: 'remove_table',
				tableName,
				description: `Removing table ${tableName} requires a reviewed migration.`,
			});
			continue;
		}

		if (oldTable && newTable) {
			diffTable(oldTable, newTable, safeChanges, blockedChanges);
		}
	}

	return {
		fromHash: hashSchemaSnapshot(from),
		toHash: hashSchemaSnapshot(to),
		safeChanges,
		blockedChanges,
	};
}

/**
 * Diffs two versions of one table into shared safe and blocked collections.
 *
 * @param from - Previous table definition.
 * @param to - Desired table definition.
 * @param safeChanges - Mutable safe-change output collection.
 * @param blockedChanges - Mutable blocked-change output collection.
 */
function diffTable(
	from: SchemaTable,
	to: SchemaTable,
	safeChanges: SafeSchemaChange[],
	blockedChanges: BlockedSchemaChange[],
): void {
	if (from.comment !== to.comment) {
		safeChanges.push({
			kind: 'alter_table_comment',
			tableName: to.name,
			comment: to.comment,
			description: `Update comment on table ${to.name}.`,
		});
	}

	const fromColumns = mapByName(from.columns);
	const toColumns = mapByName(to.columns);
	const nullableAddedColumnNames = new Set<string>();
	const columnNames = [...new Set([
		...fromColumns.keys(),
		...toColumns.keys(),
	])].sort();

	for (const columnName of columnNames) {
		const oldColumn = fromColumns.get(columnName);
		const newColumn = toColumns.get(columnName);

		if (!oldColumn && newColumn) {
			diffAddedColumn(to.name, newColumn, safeChanges, blockedChanges);

			if (isNullableAddedColumn(newColumn)) {
				nullableAddedColumnNames.add(columnName);
			}

			continue;
		}

		if (oldColumn && !newColumn) {
			blockedChanges.push({
				kind: 'blocked_change',
				operation: 'remove_column',
				tableName: to.name,
				columnName,
				description: `Removing ${to.name}.${columnName} may lose data or represent a rename.`,
			});
			continue;
		}

		if (oldColumn && newColumn) {
			diffExistingColumn(
				to.name,
				oldColumn,
				newColumn,
				from,
				to,
				safeChanges,
				blockedChanges,
			);
		}
	}

	diffIndexes(
		from,
		to,
		nullableAddedColumnNames,
		safeChanges,
		blockedChanges,
	);
	diffForeignKeys(
		from,
		to,
		nullableAddedColumnNames,
		safeChanges,
		blockedChanges,
	);
}

/**
 * Classifies an added column according to the additive migration policy.
 *
 * @param tableName - Table receiving the new column.
 * @param column - Desired new column.
 * @param safeChanges - Mutable safe-change output collection.
 * @param blockedChanges - Mutable blocked-change output collection.
 */
function diffAddedColumn(
	tableName: string,
	column: SchemaColumn,
	safeChanges: SafeSchemaChange[],
	blockedChanges: BlockedSchemaChange[],
): void {
	if (column.primary) {
		blockedChanges.push({
			kind: 'blocked_change',
			operation: 'add_required_column',
			tableName,
			columnName: column.name,
			description: `Adding required column ${tableName}.${column.name} requires a data-aware migration.`,
		});
		return;
	}

	if (column.unique) {
		blockedChanges.push({
			kind: 'blocked_change',
			operation: 'add_unique_column',
			tableName,
			columnName: column.name,
			description: `Adding unique column ${tableName}.${column.name} requires a reviewed migration.`,
		});
		return;
	}

	if (!column.nullable && !Object.hasOwn(column, 'default')) {
		blockedChanges.push({
			kind: 'blocked_change',
			operation: 'add_required_column',
			tableName,
			columnName: column.name,
			description: `Adding required column ${tableName}.${column.name} without a static default requires a data-aware migration.`,
		});
		return;
	}

	safeChanges.push({
		kind: 'add_column',
		tableName,
		column,
		description: column.nullable
			? `Add nullable column ${tableName}.${column.name}.`
			: `Add required column ${tableName}.${column.name} using its static default.`,
	});
}

/**
 * Reports whether a new nullable column can safely receive a foreign key.
 *
 * Required columns with defaults remain excluded because their generated
 * backfill value may not reference an existing parent row.
 *
 * @param column - Desired new column.
 * @returns True for nullable non-unique non-primary columns.
 */
function isNullableAddedColumn(column: SchemaColumn): boolean {
	return column.nullable && !column.primary && !column.unique;
}

/**
 * Classifies changes to an existing column.
 *
 * @param tableName - Table containing the column.
 * @param from - Previous column definition.
 * @param to - Desired column definition.
 * @param fromTable - Previous table definition used to inspect indexes.
 * @param toTable - Desired table definition used to inspect indexes.
 * @param safeChanges - Mutable safe-change output collection.
 * @param blockedChanges - Mutable blocked-change output collection.
 */
function diffExistingColumn(
	tableName: string,
	from: SchemaColumn,
	to: SchemaColumn,
	fromTable: SchemaTable,
	toTable: SchemaTable,
	safeChanges: SafeSchemaChange[],
	blockedChanges: BlockedSchemaChange[],
): void {
	let alterType = false;
	let alterNullable = false;
	const alterComment = from.comment !== to.comment;
	const alterDefault = !defaultsEqual(from, to);

	if (from.type !== to.type) {
		const indexed = columnIsIndexed(from.name, fromTable)
			|| columnIsIndexed(to.name, toTable);

		if (isSafeTypeWidening(from.type, to.type) && !indexed) {
			alterType = true;
		} else {
			blockedChanges.push({
				kind: 'blocked_change',
				operation: 'alter_column_type',
				tableName,
				columnName: to.name,
				description: `Changing ${tableName}.${to.name} from ${from.type} to ${to.type} requires review.`,
			});
		}
	}

	if (from.nullable !== to.nullable) {
		if (!from.nullable && to.nullable) {
			alterNullable = true;
		} else {
			blockedChanges.push({
				kind: 'blocked_change',
				operation: 'tighten_column_nullability',
				tableName,
				columnName: to.name,
				description: `Making ${tableName}.${to.name} required needs a null-data check.`,
			});
		}
	}

	if (from.primary !== to.primary) {
		blockedChanges.push({
			kind: 'blocked_change',
			operation: 'alter_column_primary',
			tableName,
			columnName: to.name,
			description: `Changing the primary-key status of ${tableName}.${to.name} requires review.`,
		});
	}

	if (from.unique !== to.unique) {
		blockedChanges.push({
			kind: 'blocked_change',
			operation: 'alter_column_unique',
			tableName,
			columnName: to.name,
			description: `Changing the unique constraint on ${tableName}.${to.name} requires review.`,
		});
	}

	if (alterType || alterNullable || alterComment || alterDefault) {
		safeChanges.push({
			kind: 'alter_column',
			tableName,
			column: to,
			alterType,
			alterNullable,
			alterComment,
			alterDefault,
			description: `Alter column ${tableName}.${to.name}.`,
		});
	}
}

/**
 * Classifies index additions, removals, and definition changes.
 *
 * @param from - Previous table definition.
 * @param to - Desired table definition.
 * @param addedColumnNames - Columns safely added by the same plan.
 * @param safeChanges - Mutable safe-change output collection.
 * @param blockedChanges - Mutable blocked-change output collection.
 */
function diffIndexes(
	from: SchemaTable,
	to: SchemaTable,
	addedColumnNames: ReadonlySet<string>,
	safeChanges: SafeSchemaChange[],
	blockedChanges: BlockedSchemaChange[],
): void {
	const oldIndexes = mapByName(from.indexes);
	const newIndexes = mapByName(to.indexes);
	const names = [...new Set([...oldIndexes.keys(), ...newIndexes.keys()])].sort();

	for (const name of names) {
		const oldIndex = oldIndexes.get(name);
		const newIndex = newIndexes.get(name);

		if (!oldIndex && newIndex) {
			const usesNewNullableColumn = newIndex.columns.some(column => {
				return addedColumnNames.has(column.name);
			});
			const isOrdinaryNonUniqueIndex = newIndex.type === 'normal'
				&& !newIndex.unique;

			if (isOrdinaryNonUniqueIndex || usesNewNullableColumn) {
				safeChanges.push({
					kind: 'add_index',
					tableName: to.name,
					index: newIndex,
					description: `Add index ${name} on ${to.name}.`,
				});
			} else {
				blockedChanges.push({
					kind: 'blocked_change',
					operation: 'add_index_to_existing_columns',
					tableName: to.name,
					objectName: name,
					description: `Adding index ${name} to existing columns requires review.`,
				});
			}

			continue;
		}

		if (oldIndex && !newIndex) {
			blockedChanges.push({
				kind: 'blocked_change',
				operation: 'remove_index',
				tableName: to.name,
				objectName: name,
				description: `Removing index ${name} from ${to.name} requires review.`,
			});
			continue;
		}

		if (oldIndex && newIndex && !isDeepStrictEqual(oldIndex, newIndex)) {
			blockedChanges.push({
				kind: 'blocked_change',
				operation: 'alter_index',
				tableName: to.name,
				objectName: name,
				description: `Changing index ${name} on ${to.name} requires review.`,
			});
		}
	}
}

/**
 * Classifies foreign-key additions, removals, and definition changes.
 *
 * @param from - Previous table definition.
 * @param to - Desired table definition.
 * @param addedColumnNames - Columns safely added by the same plan.
 * @param safeChanges - Mutable safe-change output collection.
 * @param blockedChanges - Mutable blocked-change output collection.
 */
function diffForeignKeys(
	from: SchemaTable,
	to: SchemaTable,
	addedColumnNames: ReadonlySet<string>,
	safeChanges: SafeSchemaChange[],
	blockedChanges: BlockedSchemaChange[],
): void {
	const oldKeys = mapByName(from.foreignKeys);
	const newKeys = mapByName(to.foreignKeys);
	const names = [...new Set([...oldKeys.keys(), ...newKeys.keys()])].sort();

	for (const name of names) {
		const oldKey = oldKeys.get(name);
		const newKey = newKeys.get(name);

		if (!oldKey && newKey) {
			if (addedColumnNames.has(newKey.column)) {
				safeChanges.push({
					kind: 'add_foreign_key',
					tableName: to.name,
					foreignKey: newKey,
					description: `Add foreign key ${name} on ${to.name}.`,
				});
			} else {
				blockedChanges.push({
					kind: 'blocked_change',
					operation: 'add_foreign_key_to_existing_column',
					tableName: to.name,
					columnName: newKey.column,
					objectName: name,
					description: `Adding foreign key ${name} to existing data requires review.`,
				});
			}

			continue;
		}

		if (oldKey && !newKey) {
			blockedChanges.push({
				kind: 'blocked_change',
				operation: 'remove_foreign_key',
				tableName: to.name,
				objectName: name,
				description: `Removing foreign key ${name} from ${to.name} requires review.`,
			});
			continue;
		}

		if (oldKey && newKey && !isDeepStrictEqual(oldKey, newKey)) {
			blockedChanges.push({
				kind: 'blocked_change',
				operation: 'alter_foreign_key',
				tableName: to.name,
				objectName: name,
				description: `Changing foreign key ${name} on ${to.name} requires review.`,
			});
		}
	}
}

/**
 * Reports whether a type change only increases string storage capacity.
 *
 * @param fromType - Previous normalized physical type.
 * @param toType - Desired normalized physical type.
 * @returns True for supported varchar/text widening transitions.
 */
function isSafeTypeWidening(fromType: string, toType: string): boolean {
	const fromVarchar = varcharLength(fromType);
	const toVarchar = varcharLength(toType);

	if (fromVarchar !== null && toVarchar !== null) {
		return toVarchar > fromVarchar;
	}

	if (fromVarchar !== null) {
		return toType === 'text' || toType === 'longtext';
	}

	return fromType === 'text' && toType === 'longtext';
}

/**
 * Extracts a normalized varchar capacity.
 *
 * @param type - Normalized physical type.
 * @returns Capacity or null when the type is not varchar.
 */
function varcharLength(type: string): number | null {
	const match = /^varchar\((\d+)\)$/.exec(type);

	return match ? Number(match[1]) : null;
}

/**
 * Tests whether a physical column participates in any table index.
 *
 * @param columnName - Physical database column name.
 * @param table - Normalized table definition.
 * @returns True when any model-owned index includes the column.
 */
function columnIsIndexed(columnName: string, table: SchemaTable): boolean {
	return table.indexes.some(index => {
		return index.columns.some(column => column.name === columnName);
	});
}

/**
 * Compares optional static database defaults without collapsing absence into
 * an explicit null value.
 *
 * @param from - Previous column definition.
 * @param to - Desired column definition.
 * @returns True when both declaration presence and values match.
 */
function defaultsEqual(from: SchemaColumn, to: SchemaColumn): boolean {
	const fromHasDefault = Object.hasOwn(from, 'default');
	const toHasDefault = Object.hasOwn(to, 'default');

	return fromHasDefault === toHasDefault
		&& isDeepStrictEqual(from.default, to.default);
}

/**
 * Indexes normalized schema objects by their stable names.
 *
 * @param values - Named normalized schema objects.
 * @returns Map keyed by physical object name.
 */
function mapByName<TValue extends { name: string }>(
	values: readonly TValue[],
): Map<string, TValue> {
	return new Map(values.map(value => [value.name, value]));
}
