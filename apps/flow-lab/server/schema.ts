import { ActiveRecord, type Database } from '@db3.ai/app/db';
import { FLOW_MODELS } from '@db3.ai/app/flows';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';

import { app } from './app.js';
import { ensureDemoData } from './demoData.js';
import { FLOW_LAB_DEMO_MODELS } from './models/index.js';

/**
 * Installs the queue and durable flow observability tables required by Flow Lab.
 *
 * @param database - Database connection to install, defaulting to the active app.
 */
export async function ensureDatabaseSchema(database: Database = app().db): Promise<void> {
	await database.install(
		QueuedJob,
		FailedJob,
		...FLOW_MODELS,
		...FLOW_LAB_DEMO_MODELS,
	);

	await ActiveRecord.withDb(database.knex, ensureDemoData);
}
