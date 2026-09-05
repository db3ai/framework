/**
 * SQL column type helpers owned by each database dialect.
 */
export interface DatabaseColumnTypes {
	varchar(length: number): string;
	char(length: number): string;
	text(): string;
	longText(): string;
	json(): string;
	boolean(): string;
	integer(options?: { unsigned?: boolean; big?: boolean }): string;
	bigIncrements(): string;
	decimal(precision: number, scale: number): string;
	timestamp(precision?: number): string;
}

export const mysqlColumnTypes: DatabaseColumnTypes = {
	varchar(length: number): string {
		return `varchar(${length})`;
	},

	char(length: number): string {
		return `char(${length})`;
	},

	text(): string {
		return 'text';
	},

	longText(): string {
		return 'longtext';
	},

	json(): string {
		return 'json';
	},

	boolean(): string {
		return 'boolean';
	},

	integer(options: { unsigned?: boolean; big?: boolean } = {}): string {
		if (options.unsigned) {
			return options.big ? 'bigint unsigned' : 'int unsigned';
		}

		return options.big ? 'bigint' : 'int';
	},

	bigIncrements(): string {
		return 'bigint unsigned auto_increment';
	},

	decimal(precision: number, scale: number): string {
		return `decimal(${precision},${scale})`;
	},

	timestamp(precision = 0): string {
		return precision > 0 ? `timestamp(${precision})` : 'timestamp';
	},
};

export const postgresColumnTypes: DatabaseColumnTypes = {
	varchar(length: number): string {
		return `varchar(${length})`;
	},

	char(length: number): string {
		return `char(${length})`;
	},

	text(): string {
		return 'text';
	},

	longText(): string {
		return 'text';
	},

	json(): string {
		return 'jsonb';
	},

	boolean(): string {
		return 'boolean';
	},

	integer(options: { unsigned?: boolean; big?: boolean } = {}): string {
		return options.big ? 'bigint' : 'integer';
	},

	bigIncrements(): string {
		return 'bigserial';
	},

	decimal(precision: number, scale: number): string {
		return `decimal(${precision},${scale})`;
	},

	timestamp(precision = 0): string {
		return precision > 0 ? `timestamp(${precision})` : 'timestamp';
	},
};
