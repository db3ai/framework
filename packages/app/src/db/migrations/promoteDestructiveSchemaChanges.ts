import type {
	BlockedSchemaChange,
	SafeSchemaChange,
	SchemaMigrationPlan,
} from './contracts';

/**
 * Blocked operations that may be promoted into generated DDL when the caller
 * explicitly opts into destructive migration generation.
 */
const PROMOTABLE_DESTRUCTIVE_OPERATIONS = new Set<BlockedSchemaChange['operation']>([
	'remove_column',
	'remove_index',
	'remove_foreign_key',
	'remove_table',
]);

/**
 * Promotes reviewed destructive removals into safe renderable changes.
 *
 * Non-destructive blocked operations (type changes, required-column adds, and
 * similar) remain blocked so accidental data-loss still requires a review.
 *
 * @param plan - Diff plan that may contain blocked removals.
 * @returns Plan with promoted drop operations, or the original plan when nothing
 *   could be promoted / remaining blocked changes still exist.
 */
export function promoteDestructiveSchemaChanges(
	plan: SchemaMigrationPlan,
): SchemaMigrationPlan {
	const remainingBlocked: BlockedSchemaChange[] = [];
	const promoted: SafeSchemaChange[] = [];

	for (const change of plan.blockedChanges) {
		if (!PROMOTABLE_DESTRUCTIVE_OPERATIONS.has(change.operation)) {
			remainingBlocked.push(change);
			continue;
		}

		const safeChange = promotedSafeChange(change);

		if (!safeChange) {
			remainingBlocked.push(change);
			continue;
		}

		promoted.push(safeChange);
	}

	if (promoted.length === 0) return plan;

	return {
		fromHash: plan.fromHash,
		toHash: plan.toHash,
		safeChanges: [...plan.safeChanges, ...promoted],
		blockedChanges: remainingBlocked,
	};
}

/**
 * Reports whether a plan still contains only promotable destructive removals.
 *
 * @param plan - Diff plan before promotion.
 * @returns True when every blocked change can be turned into a drop.
 */
export function planHasOnlyPromotableDestructiveChanges(
	plan: SchemaMigrationPlan,
): boolean {
	return plan.blockedChanges.length > 0
		&& plan.blockedChanges.every(change => {
			return PROMOTABLE_DESTRUCTIVE_OPERATIONS.has(change.operation)
				&& promotedSafeChange(change) !== null;
		});
}

/**
 * Converts one blocked removal into a renderable drop change.
 *
 * @param change - Blocked schema change.
 * @returns Safe drop change, or null when the blocked change is incomplete.
 */
function promotedSafeChange(change: BlockedSchemaChange): SafeSchemaChange | null {
	switch (change.operation) {
		case 'remove_column':
			if (!change.columnName) return null;

			return {
				kind: 'drop_column',
				tableName: change.tableName,
				columnName: change.columnName,
				description: change.description,
			};
		case 'remove_index':
			if (!change.objectName) return null;

			return {
				kind: 'drop_index',
				tableName: change.tableName,
				indexName: change.objectName,
				description: change.description,
			};
		case 'remove_foreign_key':
			if (!change.objectName) return null;

			return {
				kind: 'drop_foreign_key',
				tableName: change.tableName,
				foreignKeyName: change.objectName,
				description: change.description,
			};
		case 'remove_table':
			return {
				kind: 'drop_table',
				tableName: change.tableName,
				description: change.description,
			};
		default:
			return null;
	}
}
