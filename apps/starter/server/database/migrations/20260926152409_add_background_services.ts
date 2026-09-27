import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "b60e4e00e1a62f36c2fc9ae4b08dae53de03c15a9e699e3652544e5a1bdfd9f4",
	to: "ea562219f06a96836955cf0264bc9f1756bc005c7efe69d1c032a0df8f72a1bb",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable("jobs", table => {
		{
			const column = table.specificType("attempts", "int unsigned");
			column.notNullable();
			column.defaultTo(0);
		}
		{
			const column = table.specificType("available_at", "int unsigned");
			column.notNullable();
		}
		{
			const column = table.specificType("created_at", "int unsigned");
			column.notNullable();
		}
		{
			const column = table.specificType("id", "bigint unsigned auto_increment");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("payload", "longtext");
			column.notNullable();
		}
		{
			const column = table.specificType("queue", "varchar(255)");
			column.notNullable();
		}
		{
			const column = table.specificType("reserved_at", "int unsigned");
			column.nullable();
		}
		table.index("available_at", "jobs_available_at_index");
		table.index("queue", "jobs_queue_index");
		table.index("reserved_at", "jobs_reserved_at_index");
	});

	await knex.schema.createTable("jobs_failed", table => {
		{
			const column = table.specificType("connection", "longtext");
			column.notNullable();
		}
		{
			const column = table.specificType("exception", "longtext");
			column.notNullable();
		}
		{
			const column = table.specificType("failed_at", "timestamp");
			column.notNullable();
		}
		{
			const column = table.specificType("id", "bigint unsigned auto_increment");
			column.notNullable();
			column.primary();
		}
		{
			const column = table.specificType("payload", "longtext");
			column.notNullable();
		}
		{
			const column = table.specificType("queue", "longtext");
			column.notNullable();
		}
		{
			const column = table.specificType("uuid", "varchar(255)");
			column.notNullable();
			column.unique();
		}
	});

	await knex.schema.createTable("scheduled_occurrences", table => {
		{
			const column = table.specificType("attempts", "int unsigned");
			column.notNullable();
			column.defaultTo(0);
			column.comment("Number of queue processing attempts observed.");
		}
		{
			const column = table.specificType("claimed_at", "timestamp(3)");
			column.notNullable();
			column.comment("Time at which a scheduler process won this occurrence claim.");
		}
		{
			const column = table.specificType("dispatched_at", "timestamp(3)");
			column.nullable();
			column.comment("Time at which the queue accepted the scheduled job.");
		}
		{
			const column = table.specificType("finished_at", "timestamp(3)");
			column.nullable();
			column.comment("Terminal scheduler or queue completion time.");
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
			column.comment("Stable scheduled occurrence ULID.");
		}
		{
			const column = table.specificType("job_name", "varchar(255)");
			column.nullable();
			column.comment("Durable queue job name for job occurrences.");
		}
		{
			const column = table.specificType("kind", "varchar(20)");
			column.notNullable();
			column.comment("Whether this occurrence dispatches a job or runs an inline call.");
		}
		{
			const column = table.specificType("last_error", "longtext");
			column.nullable();
			column.comment("Most recent dispatch, callback, retry, or terminal failure.");
		}
		{
			const column = table.specificType("max_tries", "int unsigned");
			column.nullable();
			column.comment("Maximum queue attempts configured for this job.");
		}
		{
			const column = table.specificType("name", "varchar(255)");
			column.notNullable();
			column.comment("Stable registered schedule name used for deduplication.");
		}
		{
			const column = table.specificType("next_attempt_at", "timestamp");
			column.nullable();
			column.comment("Expected availability time after a retry or deferral.");
		}
		{
			const column = table.specificType("queue_job_id", "varchar(255)");
			column.nullable();
			column.comment("Driver-owned queue job id after dispatch.");
		}
		{
			const column = table.specificType("queue_job_uuid", "char(36)");
			column.nullable();
			column.comment("Stable queue UUID retained across job attempts.");
		}
		{
			const column = table.specificType("scheduled_for", "timestamp");
			column.notNullable();
			column.comment("Canonical UTC minute represented by this occurrence.");
		}
		{
			const column = table.specificType("started_at", "timestamp(3)");
			column.nullable();
			column.comment("First worker claim or inline callback start time.");
		}
		{
			const column = table.specificType("status", "varchar(20)");
			column.notNullable();
			column.defaultTo("claimed");
			column.comment("Current scheduler or queue lifecycle state.");
		}
		{
			const column = table.specificType("updated_at", "timestamp(3)");
			column.notNullable();
			column.comment("Most recent lifecycle state change.");
		}
		table.index("job_name", "scheduled_occurrences_job_name_index");
		table.unique(["name", "scheduled_for"], "scheduled_occurrences_name_scheduled_for_unique");
		table.index("queue_job_id", "scheduled_occurrences_queue_job_id_index");
		table.index("queue_job_uuid", "scheduled_occurrences_queue_job_uuid_index");
		table.index("scheduled_for", "scheduled_occurrences_scheduled_for_index");
		table.index(["status", "scheduled_for"], "scheduled_occurrences_status_scheduled_for_index");
		table.comment("Durable scheduler claims and lifecycle state for registered task occurrences.");
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
