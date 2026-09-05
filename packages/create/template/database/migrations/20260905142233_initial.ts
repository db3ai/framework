import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "419a2763cf0dfc0567ef6401a51c91aa45bf537b7be1b4a5cf6eae1470ed8310",
	to: "3ba1af915c1aedaa7339c5f5a6bf0ad35c1241c57027cec319d594a7ee9f087b",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable("auth_providers", table => {
		{
			const column = table.specificType("avatar_url", "varchar(2048)");
			column.nullable();
			column.comment("Avatar URL reported by the provider.");
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("email", "varchar(255)");
			column.nullable();
			column.comment("Email address reported or proven by this provider.");
		}
		{
			const column = table.specificType("email_verified_at", "timestamp");
			column.nullable();
			column.comment("When this provider proved the linked email address.");
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("label", "varchar(255)");
			column.nullable();
			column.comment("Human-friendly label for settings screens.");
		}
		{
			const column = table.specificType("last_login_at", "timestamp");
			column.nullable();
			column.comment("Last time this provider was used to authenticate.");
		}
		{
			const column = table.specificType("name", "varchar(255)");
			column.nullable();
			column.comment("Display name reported by the provider.");
		}
		{
			const column = table.specificType("password", "varchar(255)");
			column.nullable();
			column.comment("Password hash for the built-in password provider. Null for external providers.");
		}
		{
			const column = table.specificType("profile_json", "text");
			column.nullable();
			column.comment("Safe provider metadata captured during verification.");
		}
		{
			const column = table.specificType("provider", "varchar(64)");
			column.notNullable();
			column.comment("Stable provider name such as password, google, or magic_link.");
		}
		{
			const column = table.specificType("provider_user_id", "varchar(255)");
			column.notNullable();
			column.comment("Stable provider-owned user id. For password this is the normalized email address.");
		}
		{
			const column = table.specificType("updated_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("user_id", "varchar(255)");
			column.notNullable();
			column.comment("User account this authentication provider belongs to.");
		}
		table.unique(["provider", "provider_user_id"], "auth_providers_provider_user_id_unique");
		table.index("user_id", "auth_providers_user_id_index");
		table.unique(["user_id", "provider"], "auth_providers_user_provider_unique");
		table.comment("Authentication provider linked to a user account. Password credentials and external login identities share this table.");
	});

	await knex.schema.createTable("auth_tokens", table => {
		{
			const column = table.specificType("browser", "varchar(64)");
			column.nullable();
			column.comment("Parsed browser name used for account session displays.");
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("device", "varchar(120)");
			column.nullable();
			column.comment("Parsed device model or category used for account session displays.");
		}
		{
			const column = table.specificType("expires_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("ip_address", "varchar(45)");
			column.nullable();
			column.comment("Latest client IP address observed while this session was active.");
		}
		{
			const column = table.specificType("last_used_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("name", "varchar(120)");
			column.nullable();
		}
		{
			const column = table.specificType("operating_system", "varchar(64)");
			column.nullable();
			column.comment("Parsed operating-system name used for account session displays.");
		}
		{
			const column = table.specificType("revoked_at", "timestamp");
			column.nullable();
			column.comment("When this bearer session was explicitly revoked.");
		}
		{
			const column = table.specificType("token_hash", "varchar(64)");
			column.notNullable();
			column.unique();
		}
		{
			const column = table.specificType("user_agent", "longtext");
			column.nullable();
			column.comment("Raw client user-agent captured when this session was created.");
		}
		{
			const column = table.specificType("user_id", "varchar(255)");
			column.notNullable();
		}
		table.index("user_id", "auth_tokens_user_id_index");
	});

	await knex.schema.createTable("notes", table => {
		{
			const column = table.specificType("body", "longtext");
			column.notNullable();
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
			const column = table.specificType("owner_id", "varchar(26)");
			column.notNullable();
		}
		{
			const column = table.specificType("title", "varchar(120)");
			column.notNullable();
		}
		{
			const column = table.specificType("updated_at", "timestamp");
			column.nullable();
		}
		table.index("owner_id", "notes_owner_id_index");
	});

	await knex.schema.createTable("password_reset_tokens", table => {
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("email", "varchar(255)");
			column.notNullable();
		}
		{
			const column = table.specificType("expires_at", "timestamp");
			column.notNullable();
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("token_hash", "varchar(64)");
			column.notNullable();
			column.unique();
		}
		{
			const column = table.specificType("used_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("user_id", "varchar(255)");
			column.notNullable();
		}
	});

	await knex.schema.createTable("users", table => {
		{
			const column = table.specificType("avatar_url", "varchar(2048)");
			column.nullable();
			column.comment("Account avatar URL. External providers may supply the initial value, while the account owns later changes.");
		}
		{
			const column = table.specificType("created_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("email", "varchar(255)");
			column.notNullable();
			column.unique();
		}
		{
			const column = table.specificType("email_verified_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("last_login_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("name", "varchar(255)");
			column.notNullable();
		}
		{
			const column = table.specificType("remember_token", "varchar(100)");
			column.nullable();
		}
		{
			const column = table.specificType("two_factor_confirmed_at", "timestamp");
			column.nullable();
		}
		{
			const column = table.specificType("two_factor_recovery_codes", "text");
			column.nullable();
		}
		{
			const column = table.specificType("two_factor_secret", "longtext");
			column.nullable();
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
