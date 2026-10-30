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
		options: [
			{ name: 'retire', type: 'boolean', description: 'Record removed fields and tables as retired instead of dropping them.' },
			{ name: 'drop-retired', type: 'boolean', description: 'Drop what earlier releases retired.' },
		],
		/** Maps the CLI name and flags to the action's normal options object. */
		handle: (parameters, { options }) => makeMigration({ name: parameters.name, retire: options.retire === true, dropRetired: options['drop-retired'] === true }),
		exitCode: result => result.blocked ? 1 : 0,
	}),
];
