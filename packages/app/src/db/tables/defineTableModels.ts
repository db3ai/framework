import { ActiveRecord, type ActiveRecordClass } from '../ActiveRecord';
import type { FieldInputMap } from '../FieldType';
import type { FieldBuilder } from '../fields/field';
import { assertTableSet, type TableDefinition, type TableFieldDefinition } from './TableDefinition';

/**
 * Compiles table definitions into ActiveRecord models, so tables designed as files get the same
 * migrations, validation, forms and queries as models written in code. Links resolve to the
 * compiled model of their target table.
 *
 * @param tables - Every table definition of the app.
 * @returns One model per table, in the same order.
 */
export function defineTableModels(tables: readonly TableDefinition[]): ActiveRecordClass[] {
	assertTableSet(tables);
	const models = new Map<string, ActiveRecordClass>();
	for (const table of tables) {
		models.set(table.name, ActiveRecord.define({
			table: table.name,
			labelFields: [...(table.display ?? [])],
			fields: (field: FieldBuilder): FieldInputMap => Object.fromEntries([
				['id', field.ulid({ primary: true })],
				...table.fields.map(definition => [definition.name, compileField(field, definition, models)]),
			]),
		}));
	}
	return tables.map(table => models.get(table.name)!);
}

/** Builds one field with the framework builder that matches its type. */
function compileField(field: FieldBuilder, definition: TableFieldDefinition, models: Map<string, ActiveRecordClass>) {
	const config = {
		required: definition.required ?? false,
		...(definition.label ? { label: definition.label } : {}),
		...(definition.help ? { frontend: { props: { description: definition.help } } } : {}),
	};
	switch (definition.type) {
		case 'text': return field.string({ ...config, length: 255, maxLength: 255 });
		case 'longText': return field.text(config);
		case 'integer': return field.integer(config);
		case 'number': return field.decimal({ ...config, precision: 20, scale: 6 });
		case 'boolean': return field.boolean(config);
		case 'datetime': return field.timestamp(config);
		case 'choice': return field.choice({ ...config, choices: definition.choices! });
		case 'email': return field.email(config);
		case 'url': return field.url(config);
		case 'json': return field.json(config);
		case 'link': return field.link(() => models.get(definition.link!.table)!, { ...config, column: definition.name, onDelete: 'RESTRICT' });
	}
}
