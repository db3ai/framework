import type { ConsoleColumn, ConsoleTable } from '@db3.ai/app/console';

/** One column's settings: a label, help, a type, choices or the table it links to. */
export type FieldSetting = NonNullable<NonNullable<ConsoleTable['fields']>['fields']>[string];

/** How the row form shows a column. */
export type FieldControl = 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'choice' | 'email' | 'url' | 'link';

/** A column's saved settings, or none. */
export function settingFor(table: ConsoleTable | null, column: ConsoleColumn): FieldSetting {
	return table?.fields?.fields?.[column.name] ?? {};
}

/** The name people see for a column: its label, else its column name. */
export function labelFor(table: ConsoleTable | null, column: ConsoleColumn): string {
	return settingFor(table, column).label || column.name;
}

/** The table a column links to, from its settings or else its foreign key. */
export function linkTarget(table: ConsoleTable | null, column: ConsoleColumn): string | null {
	const setting = settingFor(table, column);
	if (setting.type) return setting.type === 'link' ? setting.link?.table ?? null : null;
	return column.references?.table ?? null;
}

/**
 * Picks a form control for a column: its saved type when it has one, else a linked row for a
 * foreign key, else from its MariaDB type.
 */
export function controlFor(column: ConsoleColumn, setting: FieldSetting = {}): FieldControl {
	if (setting.type) {
		if (setting.type === 'longText' || setting.type === 'json') return 'textarea';
		if (setting.type === 'integer') return 'number';
		return (['text', 'number', 'boolean', 'date', 'datetime', 'choice', 'email', 'url', 'link'] as string[]).includes(setting.type) ? setting.type as FieldControl : 'text';
	}
	if (column.references) return 'link';
	const type = column.dataType.toLowerCase();
	if (/^tinyint\(1\)/.test(column.columnType.toLowerCase()) || type === 'boolean' || type === 'bool') return 'boolean';
	if (['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double'].includes(type)) return 'number';
	if (['text', 'mediumtext', 'longtext', 'json'].includes(type)) return 'textarea';
	if (type === 'date') return 'date';
	if (['datetime', 'timestamp'].includes(type)) return 'datetime';
	if (type === 'enum') return 'choice';
	return 'text';
}

/** The choices of a column: its saved choices, else an enum's: `enum('draft','live')` gives draft and live. */
export function choicesOf(column: ConsoleColumn, setting: FieldSetting = {}): string[] {
	if (setting.type === 'choice' && setting.choices?.length) return setting.choices;
	const match = /^enum\((.*)\)$/i.exec(column.columnType);
	if (!match) return [];
	return [...match[1]!.matchAll(/'((?:[^']|'')*)'/g)].map(item => item[1]!.replaceAll("''", "'"));
}

/** Whether the row form may change a column: not secret, generated, auto-numbered, or (on edit) part of the key. */
export function editable(column: ConsoleColumn, editing: boolean): boolean {
	return !column.secret && !column.generated && !column.autoIncrement && !(editing && column.primary);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A new ULID, as db3 apps use for keys: 10 time characters, then 16 random ones. */
export function newUlid(now = Date.now()): string {
	let time = '';
	for (let value = now, index = 0; index < 10; index++, value = Math.floor(value / 32)) time = CROCKFORD[value % 32] + time;
	const random = crypto.getRandomValues(new Uint8Array(16));
	return time + [...random].map(byte => CROCKFORD[byte % 32]).join('');
}

/** A starting value for a new row's key column: a ULID or UUID for text keys of that length, nothing for auto-numbered ones. */
export function newKey(column: ConsoleColumn): string {
	if (column.autoIncrement || !column.primary) return '';
	const length = Number(/\((\d+)\)/.exec(column.columnType)?.[1] ?? 0);
	if (/char|binary/i.test(column.dataType) && length === 26) return newUlid();
	if (/char/i.test(column.dataType) && length === 36) return crypto.randomUUID();
	return '';
}

/**
 * Turns the form's text back into values for a write: empty becomes null where the column allows
 * it (and isn't text), numbers stay text so MariaDB parses them exactly, yes/no becomes 1 or 0.
 * When editing, only changed columns are sent.
 */
export function rowValues(table: ConsoleTable, form: Record<string, string | boolean>, original: Record<string, string | null> | null): Record<string, string | number | null> {
	const values: Record<string, string | number | null> = {};
	for (const column of table.columns) {
		if (!editable(column, Boolean(original)) || !(column.name in form)) continue;
		const raw = form[column.name];
		const control = controlFor(column, settingFor(table, column));
		let value: string | number | null = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw ?? '';
		if (value === '' && column.nullable && control !== 'text' && control !== 'textarea') value = null;
		if (value === '' && !original && column.default !== null) continue;
		if (original && String(original[column.name] ?? '') === String(value ?? '') && (original[column.name] === null) === (value === null)) continue;
		values[column.name] = value;
	}
	return values;
}

/** A row's primary key values, which name it for changes. */
export function rowKey(table: ConsoleTable, row: Record<string, string | null>): Record<string, string | null> {
	return Object.fromEntries(table.primaryKey.map(name => [name, row[name] ?? null]));
}

/** The form's starting text for a row, or for a new row. */
export function formFor(table: ConsoleTable, row: Record<string, string | null> | null): Record<string, string | boolean> {
	return Object.fromEntries(table.columns.map(column => {
		const value = row ? row[column.name] ?? '' : newKey(column);
		return [column.name, controlFor(column, settingFor(table, column)) === 'boolean' ? value === '1' || value === 'true' : value];
	}));
}

/** Where a table is defined, in words. */
export function sourceText(table: ConsoleTable): string | null {
	if (table.source?.kind === 'file') return `Designed in ${table.source.path ?? 'db3/tables'}`;
	if (table.source?.kind === 'model' || table.owner === 'code') return "Fields from the app's code";
	return null;
}
