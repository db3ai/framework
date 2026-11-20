import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Expand keeps the previous release runnable on this schema; contract removes what it may use. */
export const phase = "expand";

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "49bc32fb3afa19618c4f4a2dc93c314ca0dc08adcfb9946b3014f36fff6406d0",
	to: "25279765bde1a3bc9e8ce78016b07503ace8da551f64f3e902dcb67bec4ed454",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable("auth_tokens", table => {
		{
			const column = table.specificType("location", "varchar(160)");
			column.nullable();
			column.comment("Where the sign-in came from, such as Bristol, England, GB.");
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
