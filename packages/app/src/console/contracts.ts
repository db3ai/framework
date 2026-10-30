/**
 * The console contract: what a host (Dock on this machine, db3 Cloud for deployed environments)
 * answers so the same Database, Storage and Flows screens work in both. Apps never serve it
 * themselves. Every value is plain JSON.
 */

/** One column of a table, read from information_schema. */
export interface ConsoleColumn {
	name: string;
	dataType: string;
	columnType: string;
	nullable: boolean;
	primary: boolean;
	autoIncrement: boolean;
	generated: boolean;
	default: string | null;
	/** Looks like a secret (password hash, token): its values are never sent and it can't be changed. */
	secret: boolean;
	/** The foreign key this column holds, if any. */
	references: { table: string; column: string } | null;
}

/** Field settings saved for a table in `db3_tables`: labels, types, choices and links. */
export interface ConsoleFieldSettings {
	label?: string;
	display?: string[];
	designed?: boolean;
	fields?: Record<string, { label?: string; help?: string; type?: string; choices?: string[]; link?: { table: string } }>;
}

/** A table with its columns and keys. */
export interface ConsoleTable {
	name: string;
	/** Approximate row count from information_schema. */
	rows: number;
	columns: ConsoleColumn[];
	primaryKey: string[];
	/** Why rows can't be changed here, or null. */
	readOnly: string | null;
	/** Who owns the field settings: the app's models, the console, or nobody yet. */
	owner: 'code' | 'ui' | null;
	fields: ConsoleFieldSettings | null;
	/** Where the table is defined, when the app knows: a model in code or a file in db3/tables. */
	source: { kind: 'model' | 'file'; path?: string } | null;
}

/** One page of rows, as text values by column. */
export interface ConsoleRows {
	table: ConsoleTable;
	rows: Record<string, string | null>[];
	/** Labels of linked rows on this page, by column and then by stored value. */
	linkLabels: Record<string, Record<string, string>>;
	total: number;
	page: number;
	limit: number;
}

/** Rows another table's link column can point at, for a dropdown. */
export interface ConsoleLinkOptions {
	table: string;
	options: { value: string; label: string }[];
	more: boolean;
}

/** One configured storage disk. */
export interface ConsoleDisk {
	name: string;
	/** The disk's driver, such as `local` or `s3`, when the app configured it by name. */
	driver: string | null;
	default: boolean;
}

/** One entry in a folder listing. */
export interface ConsoleStorageEntry {
	name: string;
	type: 'dir' | 'file';
	size: number | null;
	modifiedAt: string | null;
}

/** A folder of one disk. */
export interface ConsoleStorageListing {
	disk: string;
	path: string;
	entries: ConsoleStorageEntry[];
	truncated: boolean;
}

/** A change to files on a disk. */
export type ConsoleStorageChange =
	| { disk: string; action: 'mkdir'; path: string }
	| { disk: string; action: 'move'; path: string; to: string }
	| { disk: string; action: 'delete'; path: string };

/** What this app's console offers, so screens show only what works. */
export interface ConsoleInfo {
	app: string;
	environment: string;
	database: { available: boolean; reason: string | null };
	storage: { available: boolean; reason: string | null };
	flows: { available: boolean; reason: string | null; runs: boolean };
	agents: { available: boolean; reason: string | null };
	/** Why changes are refused here, or null: definitions (`schema`) and data (`rows`) apart. */
	readOnly: { schema: string | null; rows: string | null };
}

/** Why a host refuses changes: `schema` for definitions (table design, flows), `rows` for data (rows, files). */
export interface ConsoleReadOnly {
	schema?: string | null;
	rows?: string | null;
}
