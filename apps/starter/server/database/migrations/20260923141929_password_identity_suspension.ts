import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "9484dd704b007c3f1f0fb225911fabfa90a0e923046a118f2552ba932bf5ddc0",
	to: "6f11689a66eb006b3f852ed7f2f05f8cf081dcc070736c31840898c133a11661",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	// Old provider lockout columns are deliberately retained for safe rollback.
	// Authentication now uses this independent identity table.


	await knex.schema.createTable("auth_password_login_attempts", table => {
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("failed_attempts", "int unsigned");
			column.notNullable();
			column.defaultTo(0);
			column.comment("Consecutive wrong passwords for this identity.");
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("identity_hash", "varchar(64)");
			column.notNullable();
			column.unique();
			column.comment("SHA-256 of the normalized submitted identity; not tied to account existence.");
		}
		{
			const column = table.specificType("suspended_at", "timestamp");
			column.nullable();
			column.comment("When password recovery became required; no automatic expiry.");
		}
		{
			const column = table.specificType("updated_at", "timestamp");
			column.nullable();
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
