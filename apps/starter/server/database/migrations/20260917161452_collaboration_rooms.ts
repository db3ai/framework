import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "d421964f6a17b5c0a2f007822c9fdcd18b65fda70a33b959213d1048cb15b18c",
	to: "80f9fc7d4a9963634b603fbd1a2f48624b579e3bb1de29d4f60b1f4e16052448",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable("collaboration_access", table => {
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("key", "varchar(255)");
			column.notNullable();
			column.unique();
		}
	});

	await knex.schema.createTable("collaboration_rooms", table => {
		{
			const column = table.specificType("contents", "json");
			column.notNullable();
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("name", "varchar(255)");
			column.notNullable();
			column.unique();
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
