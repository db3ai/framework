import type { SchemaColumn, SchemaForeignKey, SchemaIndex, SchemaTable } from './SchemaSnapshot';

/**
 * Schema operation that the first migration generator can apply safely.
 */
export type SafeSchemaChange =
	| {
		kind: 'create_table';
		table: SchemaTable;
		description: string;
	}
	| {
		kind: 'add_column';
		tableName: string;
		column: SchemaColumn;
		description: string;
	}
	| {
		kind: 'add_index';
		tableName: string;
		index: SchemaIndex;
		description: string;
	}
	| {
		kind: 'add_foreign_key';
		tableName: string;
		foreignKey: SchemaForeignKey;
		description: string;
	}
	| {
		kind: 'alter_column';
		tableName: string;
		column: SchemaColumn;
		alterType: boolean;
		alterNullable: boolean;
		alterComment: boolean;
		/** Whether the generated alteration changes or removes the database default. */
		alterDefault: boolean;
		description: string;
	}
	| {
		kind: 'alter_table_comment';
		tableName: string;
		comment: string | null;
		description: string;
	}
	| {
		kind: 'drop_column';
		tableName: string;
		columnName: string;
		description: string;
	}
	| {
		kind: 'drop_index';
		tableName: string;
		indexName: string;
		description: string;
	}
	| {
		kind: 'drop_foreign_key';
		tableName: string;
		foreignKeyName: string;
		description: string;
	}
	| {
		kind: 'drop_table';
		tableName: string;
		description: string;
	};

/**
 * Potentially destructive or ambiguous operation requiring a reviewed manual
 * migration before the snapshot can advance.
 */
export interface BlockedSchemaChange {
	kind: 'blocked_change';
	operation:
		| 'add_required_column'
		| 'add_unique_column'
		| 'add_index_to_existing_columns'
		| 'add_foreign_key_to_existing_column'
		| 'remove_table'
		| 'remove_column'
		| 'remove_index'
		| 'remove_foreign_key'
		| 'alter_column_type'
		| 'tighten_column_nullability'
		| 'alter_column_primary'
		| 'alter_column_unique'
		| 'alter_index'
		| 'alter_foreign_key';
	tableName: string;
	columnName?: string;
	objectName?: string;
	description: string;
}

/**
 * Pure result of comparing a previous snapshot with a desired snapshot.
 */
export interface SchemaMigrationPlan {
	/** Stable hash of the previous schema snapshot. */
	fromHash: string;

	/** Stable hash of the desired schema snapshot. */
	toHash: string;

	/** Automatically renderable additive or widening changes. */
	safeChanges: SafeSchemaChange[];

	/** Changes that must stop automatic generation. */
	blockedChanges: BlockedSchemaChange[];
}
