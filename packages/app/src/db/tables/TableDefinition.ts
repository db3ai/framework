import { z } from 'zod';

/**
 * Field types a table file can use. Each compiles to one of the framework's field builders, so
 * migrations, validation, forms and Cloud's Database view all come from the same fields.
 */
export const tableFieldTypes = ['text', 'longText', 'integer', 'number', 'boolean', 'datetime', 'choice', 'email', 'url', 'link', 'json'] as const;

/** One field's type. */
export type TableFieldType = typeof tableFieldTypes[number];

/** A table or field name: lower case, starting with a letter; `db3_` names are kept for db3. */
const name = z.string().regex(/^(?!db3_)[a-z][a-z0-9_]{0,63}$/, 'Names use lower-case letters, digits and _, start with a letter, and are at most 64 characters.');

/** One field of a table file. */
const tableField = z.object({
	name: name.refine(value => value !== 'id', 'Every table already has an id field.'),
	type: z.enum(tableFieldTypes),
	label: z.string().trim().min(1).max(120).optional(),
	help: z.string().trim().min(1).max(300).optional(),
	required: z.boolean().optional(),
	choices: z.array(z.string().trim().min(1).max(120)).min(1).max(100).optional(),
	link: z.object({ table: name }).strict().optional(),
}).strict()
	.refine(field => field.type !== 'choice' || Boolean(field.choices?.length), 'A choice field lists its choices.')
	.refine(field => field.type !== 'link' || Boolean(field.link), 'A linked field names the table it links to.');

/**
 * A table as `db3/tables/<name>.json` holds it. The `id` key (a ULID) is implicit. Version 1.
 */
export const tableDefinitionSchema = z.object({
	version: z.literal(1),
	name,
	label: z.string().trim().min(1).max(120).optional(),
	/** What the table holds; saved as the table's database comment. */
	help: z.string().trim().min(1).max(300).optional(),
	/** Up to five fields that name a row when another table links to it. */
	display: z.array(z.string()).max(5).optional(),
	fields: z.array(tableField).max(100),
}).strict().superRefine((table, context) => {
	const names = new Set<string>();
	for (const field of table.fields) {
		if (names.has(field.name)) context.addIssue({ code: 'custom', message: `${table.name} has two fields named ${field.name}.` });
		names.add(field.name);
	}
	for (const field of table.display ?? []) {
		if (field !== 'id' && !names.has(field)) context.addIssue({ code: 'custom', message: `${table.name} has no field ${field} to name its rows.` });
	}
});

/** A table definition. */
export type TableDefinition = z.infer<typeof tableDefinitionSchema>;

/** One field of a table definition. */
export type TableFieldDefinition = TableDefinition['fields'][number];

/**
 * Checks a table definition, including that every link points at a table in the same set.
 *
 * @param input - Parsed JSON.
 * @param where - Where it came from, for the error message.
 * @returns The definition.
 */
export function parseTableDefinition(input: unknown, where = 'table definition'): TableDefinition {
	const result = tableDefinitionSchema.safeParse(input);
	if (!result.success) throw new Error(`Invalid ${where}: ${result.error.issues.map(issue => issue.message).join(' ')}`);
	return result.data;
}

/**
 * Checks that links point at tables in the set and that names are unique.
 *
 * @param tables - Every table definition of the app.
 */
export function assertTableSet(tables: readonly TableDefinition[]): void {
	const names = new Set<string>();
	for (const table of tables) {
		if (names.has(table.name)) throw new Error(`Two table files define ${table.name}.`);
		names.add(table.name);
	}
	for (const table of tables) {
		for (const field of table.fields) {
			if (field.link && !names.has(field.link.table)) throw new Error(`${table.name}.${field.name} links to ${field.link.table}, which has no table file.`);
		}
	}
}
