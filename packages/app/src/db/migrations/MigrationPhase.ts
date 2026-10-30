import type { SafeSchemaChange, SchemaMigrationPlan } from './contracts';

/**
 * Expand/contract phase of one migration.
 *
 * An `expand` migration leaves the database usable by the previous release's
 * code (new tables, nullable or defaulted columns, indexes, comments, columns made optional). A
 * `contract` migration removes or tightens something, so the previous release
 * may no longer run once it has been applied.
 */
export type MigrationPhase = 'expand' | 'contract';

/**
 * Reports whether one generated change keeps the previous release's code runnable.
 * Additions, comment edits and making a column optional qualify: the previous
 * release's check ignores extra schema and comments, and still writes the column.
 * Removals, type and default changes count as contract.
 *
 * @param change - Renderable schema change.
 * @returns True when the previous release can run after this change.
 */
export function isExpandChange(change: SafeSchemaChange): boolean {
	switch (change.kind) {
		case 'create_table':
		case 'add_column':
		case 'add_index':
		case 'add_foreign_key':
		case 'alter_table_comment':
			return true;
		case 'alter_column':
			// The differ only emits nullability changes that make a column optional.
			return !change.alterType && !change.alterDefault;
		default:
			return false;
	}
}

/** Literal `export const phase = 'expand'` declaration read without executing the file. */
const PHASE_DECLARATION = /^export\s+const\s+phase\s*(?::\s*[\w'"| ]+)?=\s*['"](expand|contract)['"]/m;

/**
 * Classifies a renderable plan. One contract change makes the whole migration a contract.
 *
 * @param plan - Plan about to be rendered into a migration file.
 * @returns Phase to declare in the generated source.
 */
export function migrationPhaseForPlan(plan: SchemaMigrationPlan): MigrationPhase {
	return plan.safeChanges.every(isExpandChange) ? 'expand' : 'contract';
}

/**
 * Reads the phase a migration file declares. Files without a literal
 * declaration, such as older or hand-written migrations, count as contract
 * because nothing proves the previous release can run after them.
 *
 * @param source - Migration file source.
 * @returns Declared phase, or `contract` when none is declared.
 */
export function readMigrationPhase(source: string): MigrationPhase {
	return (PHASE_DECLARATION.exec(source)?.[1] as MigrationPhase | undefined) ?? 'contract';
}

/**
 * Reads the drops a retire migration recorded with `export const retired = [...]`.
 *
 * @param source - Migration file source.
 * @returns Recorded drop changes, empty when the file retires nothing.
 */
export function readRetiredSchema(source: string): SafeSchemaChange[] {
	const changes = readJsonExport<Record<string, string>[]>(source, 'retired') ?? [];
	return changes.map(change => ({ ...change, description: `Drop retired ${[change.tableName, change.columnName ?? change.indexName ?? change.foreignKeyName].filter(Boolean).join('.')}` }) as SafeSchemaChange);
}

/**
 * Reads the retire migrations a drop migration names with `export const dropsRetired = [...]`.
 *
 * @param source - Migration file source.
 * @returns Retire migration filenames, empty when none are named.
 */
export function readDropsRetired(source: string): string[] {
	return readJsonExport<string[]>(source, 'dropsRetired') ?? [];
}

/**
 * Parses one single-line JSON `export const` written by the migration generator.
 *
 * @param source - Migration file source.
 * @param name - Exported constant name.
 * @returns Parsed value, or undefined when absent.
 */
function readJsonExport<T>(source: string, name: string): T | undefined {
	const match = new RegExp(`^export\\s+const\\s+${name}\\s*=\\s*(\\[.*\\]);\\s*$`, 'm').exec(source);
	return match ? JSON.parse(match[1]) as T : undefined;
}
