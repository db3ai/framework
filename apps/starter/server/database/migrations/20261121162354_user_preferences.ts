import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Expand keeps the previous release runnable on this schema; contract removes what it may use. */
export const phase = "expand";

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "25279765bde1a3bc9e8ce78016b07503ace8da551f64f3e902dcb67bec4ed454",
	to: "92da2b5ef91b6951b833a49b0d40973e6bbeca3e124dab6e4c5b507849704f60",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable("users", table => {
		{
			const column = table.specificType("preferences", "json");
			column.nullable();
			column.comment("Per-user interface choices the app restores on every device, such as sidebar size. Apps own the keys.");
		}
	});
}

/**
 * Refuses automatic rollback because generated MariaDB DDL is forward-only.
 *
 * @param _knex - Unused Knex connection supplied by the migration runner.
 * @returns Promise that always rejects before performing database DDL.
 */
export async function down(_knex: Knex): Promise<void> {
	throw new Error('Generated database migrations are forward-only.');
}
