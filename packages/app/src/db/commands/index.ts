import { defineCommand } from '../../cli';
import migrate from './migrate';
import check from './check';
import makeMigration from './makeMigration';

export { migrate, check, makeMigration };

/** Explicit service command index; action files remain directly importable programmatic operations. */
export const databaseCommands = [
	defineCommand({ name: 'db:migrate', description: 'Apply committed pending database migrations.', handle: migrate }),
	defineCommand({ name: 'db:check', description: 'Check model, snapshot and live database consistency.', handle: check, exitCode: result => result.matches ? 0 : 1 }),
	defineCommand({
		name: 'db:make-migration', description: 'Generate a migration and snapshot from model changes.',
		parameters: [{ name: 'name' }],
		/** Maps the CLI name to the action's normal options object. */
		handle: parameters => makeMigration({ name: parameters.name }),
		exitCode: result => result.blocked ? 1 : 0,
	}),
];
