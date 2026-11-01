import type { Knex } from 'knex';

/** Knex migration settings for MariaDB non-transactional DDL. */
export const config = { transaction: false };

/** Expand keeps the previous release runnable on this schema; contract removes what it may use. */
export const phase = "expand";

/** Frozen schema lineage recorded when this migration was generated. */
export const schema = {
	from: "9d86ecdc5d94370bcde7fa22eb228440b3f7cf666dca35d31ad9e62af275804e",
	to: "842a462c4868df2859680e0a9ac688fe80571969d2477c489134e626de750966",
};

/**
 * Applies this forward-only generated database migration.
 *
 * @param knex - Knex connection managed by the application migration runner.
 * @returns Promise that resolves after every schema operation completes.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable("jobs_workers", table => {
		{
			const column = table.specificType("current_job_id", "varchar(255)");
			column.nullable();
		}
		{
			const column = table.specificType("current_queue", "varchar(255)");
			column.nullable();
		}
		{
			const column = table.specificType("failed", "int unsigned");
			column.notNullable();
			column.defaultTo(0);
			column.comment("Jobs that failed for good since the worker started.");
		}
		{
			const column = table.specificType("heartbeat_at", "int unsigned");
			column.notNullable();
			column.comment("Unix seconds of the latest report.");
		}
		{
			const column = table.specificType("hostname", "varchar(255)");
			column.notNullable();
			column.comment("Host the worker runs on; the pod name under Kubernetes.");
		}
		{
			const column = table.specificType("id", "char(26)");
			column.notNullable();
			column.primary();
			column.comment("Worker slot identity from QueueWorkerSnapshot.");
		}
		{
			const column = table.specificType("last_job_at", "int unsigned");
			column.nullable();
			column.comment("Unix seconds when the latest job finished.");
		}
		{
			const column = table.specificType("name", "varchar(255)");
			column.notNullable();
			column.comment("Worker name, such as the --name option or QUEUE_WORKER_NAME.");
		}
		{
			const column = table.specificType("pid", "int unsigned");
			column.notNullable();
		}
		{
			const column = table.specificType("processed", "int unsigned");
			column.notNullable();
			column.defaultTo(0);
			column.comment("Jobs that succeeded since the worker started.");
		}
		{
			const column = table.specificType("selection", "longtext");
			column.notNullable();
			column.comment("Queues the worker consumes and excludes.");
		}
		{
			const column = table.specificType("started_at", "int unsigned");
			column.notNullable();
			column.comment("Unix seconds.");
		}
		{
			const column = table.specificType("status", "varchar(16)");
			column.notNullable();
			column.comment("idle, busy, stopping or stopped.");
		}
		table.index("heartbeat_at", "jobs_workers_heartbeat_at_index");
		table.index("hostname", "jobs_workers_hostname_index");
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
