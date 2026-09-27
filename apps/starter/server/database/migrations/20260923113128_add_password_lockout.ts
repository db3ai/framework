import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "80f9fc7d4a9963634b603fbd1a2f48624b579e3bb1de29d4f60b1f4e16052448",
	to: "9484dd704b007c3f1f0fb225911fabfa90a0e923046a118f2552ba932bf5ddc0",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable("auth_providers", table => {
		{
			const column = table.specificType("failed_password_attempts", "int unsigned");
			column.notNullable();
			column.defaultTo(0);
			column.comment("Consecutive wrong passwords since the last successful sign-in or reset.");
		}
	});

	await knex.schema.alterTable("auth_providers", table => {
		{
			const column = table.specificType("password_locked_until", "timestamp");
			column.nullable();
			column.comment("Password sign-in is refused until this time after too many failures.");
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
