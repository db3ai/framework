import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "ea562219f06a96836955cf0264bc9f1756bc005c7efe69d1c032a0df8f72a1bb",
	to: "9d86ecdc5d94370bcde7fa22eb228440b3f7cf666dca35d31ad9e62af275804e",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable("ai_conversations", table => {
		{
			const column = table.specificType("stream_state", "json");
			column.nullable();
			column.comment("Latest run and conditional stream-writer ownership.");
		}
	});

	await knex.schema.alterTable("ai_requests", table => {
		{
			const column = table.specificType("admission_hash", "varchar(64)");
			column.nullable();
			column.comment("Canonical admitted input digest; rejects a reused key with different input.");
		}
	});

	await knex.schema.alterTable("ai_requests", table => {
		{
			const column = table.specificType("admission_key", "varchar(64)");
			column.nullable();
			column.unique();
			column.comment("Hashed actor, scope, agent and submission key; null for provider requests.");
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
