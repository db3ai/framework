import type {
	SafeSchemaChange,
	SchemaColumn,
	SchemaForeignKey,
	SchemaIndex,
	SchemaMigrationPlan,
	SchemaTable,
} from './contracts';

/**
 * Renders a frozen TypeScript Knex migration from a safe schema plan.
 *
 * Generated source contains literal table, column, index, and foreign-key
 * operations. It never imports current models or field implementations.
 *
 * @param plan - Pure schema plan with no blocked changes.
 * @returns Deterministic TypeScript migration source.
 */
export function renderKnexMigration(plan: SchemaMigrationPlan): string {
	if (plan.blockedChanges.length > 0) {
		throw new Error('Cannot render a migration plan containing blocked changes.');
	}

	if (plan.safeChanges.length === 0) {
		throw new Error('Cannot render an empty database migration.');
	}

	const lines = [
		"import type { Knex } from 'knex';",
		'',
		'/** Knex migration settings for MariaDB non-transactional DDL. */',
		'export const config = { transaction: false };',
		'',
		'/** Frozen schema lineage recorded when this migration was generated. */',
		'export const schema = {',
		`\tfrom: ${quote(plan.fromHash)},`,
		`\tto: ${quote(plan.toHash)},`,
		'};',
		'',
		'/**',
		' * Applies this forward-only generated database migration.',
		' *',
		' * @param knex - Knex connection managed by the application migration runner.',
		' * @returns Promise that resolves after every schema operation completes.',
		' */',
		'export async function up(knex: Knex): Promise<void> {',
	];

	const body = renderMigrationBody(plan.safeChanges);

	lines.push(...body.map(line => line ? `\t${line}` : ''));
	lines.push(
		'}',
		'',
		'/**',
		' * Refuses automatic rollback because generated MariaDB DDL is forward-only.',
		' *',
		' * @param _knex - Unused Knex connection supplied by the migration runner.',
		' * @returns Promise that always rejects before performing database DDL.',
		' */',
		'export async function down(_knex: Knex): Promise<void> {',
		"\tthrow new Error('Generated database migrations are forward-only.');",
		'}',
		'',
	);

	return lines.join('\n');
}

/**
 * Orders migration DDL so all new tables exist before foreign keys are added.
 *
 * @param changes - Safe normalized schema changes.
 * @returns TypeScript statements without the outer function indentation.
 */
function renderMigrationBody(changes: readonly SafeSchemaChange[]): string[] {
	const lines: string[] = [];
	const createTables = changes.filter(isChangeKind('create_table'));
	const otherChanges = changes.filter(change => change.kind !== 'create_table');

	for (const change of otherChanges) {
		if (change.kind === 'drop_foreign_key') {
			appendStatement(lines, renderDropForeignKey(change.tableName, change.foreignKeyName));
		}
	}

	for (const change of otherChanges) {
		if (change.kind === 'drop_index') {
			appendStatement(lines, renderDropIndex(change.tableName, change.indexName));
		}
	}

	for (const change of otherChanges) {
		if (change.kind === 'drop_column') {
			appendStatement(lines, renderDropColumn(change.tableName, change.columnName));
		}
	}

	for (const change of createTables) {
		appendStatement(lines, renderCreateTable(change.table));
	}

	for (const change of otherChanges) {
		if (change.kind === 'alter_table_comment') {
			appendStatement(lines, renderAlterTableComment(change.tableName, change.comment));
		}
	}

	for (const change of otherChanges) {
		if (change.kind === 'add_column') {
			appendStatement(lines, renderAddColumn(change.tableName, change.column));
		}

		if (change.kind === 'alter_column') {
			appendStatement(lines, renderAlterColumn(change));
		}
	}

	for (const change of otherChanges) {
		if (change.kind === 'add_index') {
			appendStatement(lines, renderAddIndex(change.tableName, change.index));
		}
	}

	const foreignKeys = [
		...createTables.flatMap(change => {
			return change.table.foreignKeys.map(foreignKey => ({
				tableName: change.table.name,
				foreignKey,
			}));
		}),
		...otherChanges.flatMap(change => {
			return change.kind === 'add_foreign_key'
				? [{ tableName: change.tableName, foreignKey: change.foreignKey }]
				: [];
		}),
	];

	for (const { tableName, foreignKey } of foreignKeys) {
		appendStatement(lines, renderAddForeignKey(tableName, foreignKey));
	}

	for (const change of otherChanges) {
		if (change.kind === 'drop_table') {
			appendStatement(lines, renderDropTable(change.tableName));
		}
	}

	return lines;
}

/**
 * Appends one statement separated from the previous statement by a blank line.
 *
 * @param target - Mutable migration body lines.
 * @param statement - Complete statement lines to append.
 */
function appendStatement(target: string[], statement: readonly string[]): void {
	if (target.length > 0) target.push('');
	target.push(...statement);
}

/**
 * Renders one table creation without foreign keys, which are emitted later.
 *
 * @param table - Complete desired table definition.
 * @returns TypeScript statement lines.
 */
function renderCreateTable(table: SchemaTable): string[] {
	const lines = [
		`await knex.schema.createTable(${quote(table.name)}, table => {`,
	];

	for (const column of table.columns) {
		lines.push(...indent(renderColumn(column, {
			creation: true,
			alterNullable: true,
			alterType: true,
			alterComment: true,
		})));
	}

	for (const index of table.indexes) {
		lines.push(...indent(renderIndex(index)));
	}

	if (table.comment) {
		lines.push(`\ttable.comment(${quote(table.comment)});`);
	}

	lines.push('});');

	return lines;
}

/**
 * Renders one nullable-column addition.
 *
 * @param tableName - Table receiving the column.
 * @param column - Desired new column definition.
 * @returns TypeScript statement lines.
 */
function renderAddColumn(tableName: string, column: SchemaColumn): string[] {
	return [
		`await knex.schema.alterTable(${quote(tableName)}, table => {`,
		...indent(renderColumn(column, {
			creation: true,
			alterNullable: true,
			alterType: true,
			alterComment: true,
		})),
		'});',
	];
}

/**
 * Renders one safe existing-column alteration.
 *
 * @param change - Normalized safe column change.
 * @returns TypeScript statement lines.
 */
function renderAlterColumn(
	change: Extract<SafeSchemaChange, { kind: 'alter_column' }>,
): string[] {
	return [
		`await knex.schema.alterTable(${quote(change.tableName)}, table => {`,
		...indent(renderColumn(change.column, {
			creation: false,
			alterNullable: change.alterNullable,
			alterType: change.alterType,
			alterComment: change.alterComment,
		})),
		'});',
	];
}

/**
 * Renders one table comment change, using an empty comment to clear it.
 *
 * @param tableName - Table receiving the comment.
 * @param comment - Desired normalized comment.
 * @returns TypeScript statement lines.
 */
function renderAlterTableComment(
	tableName: string,
	comment: string | null,
): string[] {
	return [
		`await knex.schema.alterTable(${quote(tableName)}, table => {`,
		`\ttable.comment(${quote(comment ?? '')});`,
		'});',
	];
}

/**
 * Renders one named index addition.
 *
 * @param tableName - Table receiving the index.
 * @param index - Desired normalized index definition.
 * @returns TypeScript statement lines.
 */
function renderAddIndex(tableName: string, index: SchemaIndex): string[] {
	return [
		`await knex.schema.alterTable(${quote(tableName)}, table => {`,
		...indent(renderIndex(index)),
		'});',
	];
}

/**
 * Renders one named foreign-key addition.
 *
 * @param tableName - Local table receiving the constraint.
 * @param foreignKey - Desired normalized foreign key.
 * @returns TypeScript statement lines.
 */
function renderAddForeignKey(
	tableName: string,
	foreignKey: SchemaForeignKey,
): string[] {
	const lines = [
		`await knex.schema.alterTable(${quote(tableName)}, table => {`,
		'\tlet foreign = table',
		`\t\t.foreign(${quote(foreignKey.column)}, ${quote(foreignKey.name)})`,
		`\t\t.references(${quote(foreignKey.referencesColumn)})`,
		`\t\t.inTable(${quote(foreignKey.referencesTable)});`,
	];

	if (foreignKey.onDelete) {
		lines.push('', `\tforeign = foreign.onDelete(${quote(foreignKey.onDelete)});`);
	}

	if (foreignKey.onUpdate) {
		lines.push('', `\tforeign.onUpdate(${quote(foreignKey.onUpdate)});`);
	}

	lines.push('});');

	return lines;
}

/**
 * Renders one named foreign-key drop.
 *
 * @param tableName - Local table owning the constraint.
 * @param foreignKeyName - Stable foreign-key name.
 * @returns TypeScript statement lines.
 */
function renderDropForeignKey(tableName: string, foreignKeyName: string): string[] {
	return [
		`await knex.schema.raw('ALTER TABLE ?? DROP FOREIGN KEY ??', [${quote(tableName)}, ${quote(foreignKeyName)}]);`,
	];
}

/**
 * Renders one named index drop.
 *
 * @param tableName - Table owning the index.
 * @param indexName - Stable index name.
 * @returns TypeScript statement lines.
 */
function renderDropIndex(tableName: string, indexName: string): string[] {
	return [
		`await knex.schema.raw('ALTER TABLE ?? DROP INDEX ??', [${quote(tableName)}, ${quote(indexName)}]);`,
	];
}

/**
 * Renders one column drop.
 *
 * @param tableName - Table owning the column.
 * @param columnName - Physical column name.
 * @returns TypeScript statement lines.
 */
function renderDropColumn(tableName: string, columnName: string): string[] {
	return [
		`await knex.schema.alterTable(${quote(tableName)}, table => {`,
		`\ttable.dropColumn(${quote(columnName)});`,
		'});',
	];
}

/**
 * Renders one table drop.
 *
 * @param tableName - Table to remove.
 * @returns TypeScript statement lines.
 */
function renderDropTable(tableName: string): string[] {
	return [
		`await knex.schema.dropTableIfExists(${quote(tableName)});`,
	];
}

interface RenderColumnOptions {
	creation: boolean;
	alterNullable: boolean;
	alterType: boolean;
	alterComment: boolean;
}

/**
 * Renders a column builder inside a small lexical block so every column can
 * reuse the same readable local variable name.
 *
 * @param column - Desired normalized column definition.
 * @param options - Creation or alteration facets to emit.
 * @returns TypeScript callback lines.
 */
function renderColumn(
	column: SchemaColumn,
	options: RenderColumnOptions,
): string[] {
	const lines = [
		'{',
		`\tconst column = table.specificType(${quote(column.name)}, ${quote(column.type)});`,
	];

	lines.push(column.nullable
		? '\tcolumn.nullable();'
		: '\tcolumn.notNullable();');

	if (options.creation && column.primary) {
		lines.push('\tcolumn.primary();');
	}

	if (options.creation && column.unique) {
		lines.push('\tcolumn.unique();');
	}

	if (Object.hasOwn(column, 'default')) {
		lines.push(`\tcolumn.defaultTo(${renderValue(column.default)});`);
	}

	if (column.comment || (!options.creation && options.alterComment)) {
		lines.push(`\tcolumn.comment(${quote(column.comment ?? '')});`);
	}

	if (!options.creation) {
		lines.push(
			`\tcolumn.alter({ alterNullable: ${options.alterNullable}, alterType: ${options.alterType} });`,
		);
	}

	lines.push('}');

	return lines;
}

/**
 * Renders one normalized index inside a Knex table callback.
 *
 * @param index - Desired named index.
 * @returns TypeScript callback lines.
 */
function renderIndex(index: SchemaIndex): string[] {
	const columns = renderIndexColumns(index);

	if (index.type === 'vector') {
		return [`table.index(${columns}, ${quote(index.name)}, 'vector');`];
	}

	if (index.unique) {
		return [`table.unique(${columns}, ${quote(index.name)});`];
	}

	return [`table.index(${columns}, ${quote(index.name)});`];
}

/**
 * Renders scalar or raw ordered index columns.
 *
 * @param index - Desired normalized index.
 * @returns TypeScript expression accepted by Knex index methods.
 */
function renderIndexColumns(index: SchemaIndex): string {
	const columns = index.columns.map(column => {
		return column.order
			? `knex.raw('?? ${column.order}', [${quote(column.name)}])`
			: quote(column.name);
	});

	return columns.length === 1 && !index.columns[0]?.order
		? columns[0] ?? '[]'
		: `[${columns.join(', ')}]`;
}

/**
 * Adds one tab of indentation to rendered callback lines.
 *
 * @param lines - Lines to indent.
 * @returns New indented line collection.
 */
function indent(lines: readonly string[]): string[] {
	return lines.map(line => line ? `\t${line}` : '');
}

/**
 * Renders a JSON-safe schema value as a TypeScript literal.
 *
 * @param value - Frozen static database default.
 * @returns TypeScript literal expression.
 */
function renderValue(value: unknown): string {
	return JSON.stringify(value);
}

/**
 * Renders a string as a deterministic double-quoted literal.
 *
 * @param value - String to quote.
 * @returns JSON-compatible TypeScript string literal.
 */
function quote(value: string): string {
	return JSON.stringify(value);
}

/**
 * Builds a type guard for one discriminant kind.
 *
 * @param kind - Safe change kind to retain.
 * @returns Array-filter predicate narrowing to that change kind.
 */
function isChangeKind<TKind extends SafeSchemaChange['kind']>(kind: TKind) {
	return (
		change: SafeSchemaChange,
	): change is Extract<SafeSchemaChange, { kind: TKind }> => {
		return change.kind === kind;
	};
}
