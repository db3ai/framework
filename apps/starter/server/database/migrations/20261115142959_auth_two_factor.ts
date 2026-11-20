import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Expand keeps the previous release runnable on this schema; contract removes what it may use. */
export const phase = "expand";

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "e59e7199e425b5a60436f45d58abb86887daa73cb45f06bbae9708ff42e2ad24",
	to: "49bc32fb3afa19618c4f4a2dc93c314ca0dc08adcfb9946b3014f36fff6406d0",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable("auth_two_factor", table => {
		{
			const column = table.specificType("confirmed_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("last_step", "int unsigned");
			column.nullable();
			column.comment("Last accepted 30 s step, so a code works once.");
		}
		{
			const column = table.specificType("recovery_codes", "json");
			column.nullable();
			column.comment("SHA-256 hashes of unused recovery codes.");
		}
		{
			const column = table.specificType("secret", "longtext");
			column.notNullable();
			column.comment("Base32 TOTP secret, encrypted.");
		}
		{
			const column = table.specificType("user_id", "varchar(255)");
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
