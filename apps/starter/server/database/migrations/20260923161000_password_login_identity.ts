import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "6f11689a66eb006b3f852ed7f2f05f8cf081dcc070736c31840898c133a11661",
	to: "b60e4e00e1a62f36c2fc9ae4b08dae53de03c15a9e699e3652544e5a1bdfd9f4",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable("auth_password_login_attempts", table => {
		{
			const column = table.specificType("identity", "varchar(255)");
			column.nullable();
			column.comment("Normalized submitted email or configured identity; null for legacy digest-only rows until their next attempt.");
		}
	});

	await knex.schema.alterTable("auth_password_login_attempts", table => {
		{
			const column = table.specificType("suspension_id", "varchar(36)");
			column.nullable();
			column.comment("Unique suspension occurrence; prevents delayed recovery notices from referring to a later suspension.");
		}
	});

	await knex.schema.alterTable("auth_password_login_attempts", table => {
		{
			const column = table.specificType("updated_at", "timestamp");
			column.nullable();
			column.comment("Latest password sign-in or recovery activity, including refused suspended attempts.");
			column.alter({ alterNullable: false, alterType: false });
		}
	});

	await knex.schema.alterTable("auth_password_login_attempts", table => {
		table.index("updated_at", "auth_password_login_attempts_updated_at_index");
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
