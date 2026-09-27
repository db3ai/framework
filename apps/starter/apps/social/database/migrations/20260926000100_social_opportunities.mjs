/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };
/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "419a2763cf0dfc0567ef6401a51c91aa45bf537b7be1b4a5cf6eae1470ed8310",
	to: "056f5f840085845f343a30e6c920ee09d5e0b86aba0e2bf656a5e4ef2fa06b05",
};
/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex) {
	await knex.schema.createTable("social_opportunities", table => {
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
			const column = table.specificType("notes", "longtext");
			column.notNullable();
		}
		{
			const column = table.specificType("owner_id", "varchar(26)");
			column.notNullable();
		}
		{
			const column = table.specificType("status", "varchar(16)");
			column.notNullable();
			column.defaultTo("saved");
		}
		{
			const column = table.specificType("title", "varchar(200)");
			column.notNullable();
		}
		{
			const column = table.specificType("url", "varchar(2048)");
			column.notNullable();
		}
		table.index("owner_id", "social_opportunities_owner_id_index");
	});
}
/**
 * Refuses automatic rollback because generated MariaDB DDL is forward-only.
 *
 * @param _knex - Unused Knex connection supplied by the migration runner.
 * @returns Promise that always rejects before performing database DDL.
 */
export async function down(_knex) {
	throw new Error('Generated database migrations are forward-only.');
}
