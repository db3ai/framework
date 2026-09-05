import type { DatabaseDialectName } from '../../dialects';

/**
 * JSON-safe value that can be frozen into a schema snapshot and migration.
 */
export type SchemaValue = null | string | number | boolean | SchemaValue[] | {
	[key: string]: SchemaValue;
};

/**
 * Normalized database column owned by an ActiveRecord model.
 */
export interface SchemaColumn {
	/** Physical database column name. */
	name: string;

	/** Dialect-specific SQL column type. */
	type: string;

	/** Whether the database column accepts null values. */
	nullable: boolean;

	/** Whether the database column is the table primary key. */
	primary: boolean;

	/** Whether the database column has a single-column unique constraint. */
	unique: boolean;

	/** Static database default, when the model declares one. */
	default?: SchemaValue;

	/** Normalized database-native column comment. */
	comment: string | null;
}

/**
 * One ordered column in a normalized database index.
 */
export interface SchemaIndexColumn {
	/** Physical database column name. */
	name: string;

	/** Optional explicit index ordering. */
	order?: 'asc' | 'desc';
}

/**
 * Named database index owned by an ActiveRecord model.
 */
export interface SchemaIndex {
	/** Stable database index name. */
	name: string;

	/** Ordered columns included in the index. */
	columns: SchemaIndexColumn[];

	/** Whether values must be unique across the index columns. */
	unique: boolean;

	/** Database index implementation. */
	type: 'normal' | 'vector';
}

/**
 * Named foreign-key constraint owned by an ActiveRecord model.
 */
export interface SchemaForeignKey {
	/** Stable database constraint name. */
	name: string;

	/** Local physical database column. */
	column: string;

	/** Referenced physical database table. */
	referencesTable: string;

	/** Referenced physical database column. */
	referencesColumn: string;

	/** Optional action applied when a referenced row is deleted. */
	onDelete?: 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION';

	/** Optional action applied when a referenced key changes. */
	onUpdate?: 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION';
}

/**
 * Normalized database table owned by one ActiveRecord model.
 */
export interface SchemaTable {
	/** Physical database table name. */
	name: string;

	/** Normalized database-native table comment. */
	comment: string | null;

	/** Columns sorted by physical name for deterministic serialization. */
	columns: SchemaColumn[];

	/** Indexes sorted by stable database name. */
	indexes: SchemaIndex[];

	/** Foreign keys sorted by stable database name. */
	foreignKeys: SchemaForeignKey[];
}

/**
 * Serializable desired database state collected from ActiveRecord models.
 *
 * Snapshots deliberately contain no model imports or executable values so an
 * old migration remains reproducible after application models change.
 */
export interface SchemaSnapshot {
	/** Snapshot format used to support future schema-tool upgrades. */
	formatVersion: 1;

	/** Database dialect used to resolve model field types. */
	dialect: DatabaseDialectName;

	/** Model-owned tables sorted by physical database name. */
	tables: SchemaTable[];
}
