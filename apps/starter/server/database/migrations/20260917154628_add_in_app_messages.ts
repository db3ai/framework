import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "f14ed111bb552072838c18f3fe8be06051d82ab3404a0e335694cacafe8cb025",
	to: "d421964f6a17b5c0a2f007822c9fdcd18b65fda70a33b959213d1048cb15b18c",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable("in_app_messages", table => {
		{
			const column = table.specificType("archived_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("content_hash", "varchar(64)");
			column.notNullable();
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("deduplication_hash", "varchar(64)");
			column.nullable();
			column.unique();
		}
		{
			const column = table.specificType("dismissed_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("message", "json");
			column.notNullable();
		}
		{
			const column = table.specificType("presentation", "varchar(16)");
			column.notNullable();
		}
		{
			const column = table.specificType("read_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("scope_id", "varchar(255)");
			column.notNullable();
		}
		{
			const column = table.specificType("scope_type", "varchar(80)");
			column.notNullable();
		}
		{
			const column = table.specificType("type", "varchar(120)");
			column.notNullable();
		}
		{
			const column = table.specificType("user_id", "varchar(255)");
			column.notNullable();
		}
		table.index(["user_id", "scope_type", "scope_id"], "in_app_recipient_scope");
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
