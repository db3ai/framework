import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Expand keeps the previous release runnable on this schema; contract removes what it may use. */
export const phase = "expand";

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "842a462c4868df2859680e0a9ac688fe80571969d2477c489134e626de750966",
	to: "e59e7199e425b5a60436f45d58abb86887daa73cb45f06bbae9708ff42e2ad24",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable("jobs_workers", table => {
		{
			const column = table.specificType("busy", "int unsigned");
			column.nullable();
			column.comment("Slots running a job at the latest report.");
		}
	});

	await knex.schema.alterTable("jobs_workers", table => {
		{
			const column = table.specificType("slots", "int unsigned");
			column.nullable();
			column.comment("Execution slots in this worker.");
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
