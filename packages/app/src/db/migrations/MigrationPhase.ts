import type { SafeSchemaChange, SchemaMigrationPlan } from './contracts';

/**
 * Expand/contract phase of one migration.
 *
 * An `expand` migration leaves the database usable by the previous release's
 * code (new tables, nullable or defaulted columns, indexes, comments). A
 * `contract` migration removes or tightens something, so the previous release
 * may no longer run once it has been applied.
 */
export type MigrationPhase = 'expand' | 'contract';

/**
 * Reports whether one generated change keeps the previous release's code runnable.
 * Only additions and comment edits qualify: the previous release's schema check
 * ignores extra tables, columns and indexes and treats comments as presentation.
 * Removals, type, nullability and default changes count as contract.
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
			return !change.alterType && !change.alterNullable && !change.alterDefault;
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
