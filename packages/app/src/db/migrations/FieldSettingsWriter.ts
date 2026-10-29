import type { Knex } from 'knex';
import type { ActiveRecordClass } from '../ActiveRecord';
import type { FieldType } from '../FieldType';
import {
	BooleanField,
	ChoiceStringField,
	DecimalField,
	EmailField,
	EncryptedJsonField,
	IntegerField,
	JsonField,
	LinkField,
	PasswordField,
	TextField,
	TimestampField,
} from '../fields';
import { UrlField } from '../fields/UrlField';
import { VectorField } from '../fields/VectorField';

/**
 * Table, inside the app's own database, where db3 Cloud's Database view reads field settings.
 * Rows owned by `code` come from models; Cloud shows them read-only and never changes them.
 */
export const FIELD_SETTINGS_TABLE = 'db3_tables';

/** Field types the Database view understands; columns without one are inferred from SQL. */
export type FieldSettingType =
	| 'text'
	| 'longText'
	| 'number'
	| 'boolean'
	| 'datetime'
	| 'choice'
	| 'email'
	| 'url'
	| 'link'
	| 'json';

/** One column's settings, keyed by its physical column name. */
export interface FieldSetting {
	label?: string;
	type?: FieldSettingType;
	choices?: string[];
	link?: { table: string };
}

/** One table's settings: the columns that name its rows and each column's field. */
export interface TableFieldSettings {
	display?: string[];
	fields: Record<string, FieldSetting>;
}

/**
 * Describes a model's fields for the Database view: labels, a type per column, choices, and
 * link targets, keyed by physical column, plus the model's label fields as row label columns.
 * Secret fields (passwords, encrypted JSON) and vectors are left out.
 *
 * @param Model - ActiveRecord model.
 * @returns Field settings for the model's table.
 */
export function collectFieldSettings(Model: ActiveRecordClass): TableFieldSettings {
	const fields: Record<string, FieldSetting> = {};
	const columns: Record<string, string> = {};

	for (const [fieldName, field] of Object.entries(Model.getFields())) {
		const setting = fieldSetting(field);
		if (!setting) continue;
		const column = field.getColumnFor(Model, fieldName);
		columns[fieldName] = column;
		const label = typeof field.config.label === 'string' ? field.config.label.trim() : '';
		fields[column] = { ...(label ? { label } : {}), ...setting };
	}

	const display = (Model.labelFields ?? [])
		.map(name => columns[name])
		.filter((column): column is string => Boolean(column))
		.slice(0, 5);

	return { ...(display.length ? { display } : {}), fields };
}

/**
 * Picks the Database view type for a field, most specific class first.
 *
 * @param field - Field blueprint.
 * @returns Its setting without a label, or null for fields the view must not show.
 */
function fieldSetting(field: FieldType<any, any, any, any, any>): FieldSetting | null {
	if (field instanceof PasswordField || field instanceof EncryptedJsonField || field instanceof VectorField) return null;
	if (field instanceof LinkField) return { type: 'link', link: { table: field.config.target().table } };
	if (field instanceof ChoiceStringField) return { type: 'choice', choices: [...field.config.choices] };
	if (field instanceof EmailField) return { type: 'email' };
	if (field instanceof UrlField) return { type: 'url' };
	if (field instanceof TextField) return { type: 'longText' };
	if (field instanceof BooleanField) return { type: 'boolean' };
	if (field instanceof IntegerField || field instanceof DecimalField) return { type: 'number' };
	if (field instanceof TimestampField) return { type: 'datetime' };
	if (field instanceof JsonField) return { type: 'json' };
	return {};
}

/**
 * Saves the models' field settings as code-owned rows in `db3_tables`, creating the table when
 * missing. Settings that people made in Cloud for other tables stay as they are; a model's table
 * always takes its code-owned settings.
 *
 * @param db - Connection to the app's database.
 * @param models - Models whose tables the app owns.
 * @returns How many tables were written.
 */
export async function writeFieldSettings(db: Knex, models: readonly ActiveRecordClass[]): Promise<number> {
	if (!models.length) return 0;
	if (!await db.schema.hasTable(FIELD_SETTINGS_TABLE)) {
		await db.schema.createTable(FIELD_SETTINGS_TABLE, table => {
			table.string('name', 64).primary();
			table.string('owner', 10).notNullable();
			table.text('definition', 'longtext').notNullable();
			table.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
		}).catch(async error => {
			// Another process may have created it first.
			if (!await db.schema.hasTable(FIELD_SETTINGS_TABLE)) throw error;
		});
	}

	const rows = models.map(Model => ({
		name: Model.table,
		owner: 'code',
		definition: JSON.stringify(collectFieldSettings(Model)),
		updated_at: new Date(),
	}));
	await db(FIELD_SETTINGS_TABLE).insert(rows).onConflict('name').merge(['owner', 'definition', 'updated_at']);
	return rows.length;
}
