import { defineCommand } from '../../cli';
import { listApps } from './listApps';
import { installApp } from './installApp';
import { enableApp } from './enableApp';
import { disableApp } from './disableApp';
import { uninstallApp } from './uninstallApp';
import { rollbackApp } from './rollbackApp';
import { makeAppMigration } from './makeAppMigration';

export { listApps, installApp, enableApp, disableApp, uninstallApp, makeAppMigration, rollbackApp };

/** CLI adapters for the same app-management operations used by programmatic and visual clients. */
export const appsCommands = [
	defineCommand({ name: 'apps:list', description: 'Inspect app definitions and installation state.', handle: listApps }),
	defineCommand({
		name: 'apps:make-migration', description: 'Generate a local app migration without changing the database.',
		parameters: [{ name: 'id', required: true }, { name: 'name', required: false }],
		/** Delegates development source generation to the app-owned migration manager. */
		handle: parameters => makeAppMigration(parameters.id!, parameters.name),
	}),
	...[
		['install', installApp], ['enable', enableApp], ['disable', disableApp], ['uninstall', uninstallApp], ['rollback', rollbackApp],
	].map(([action, operation]) => defineCommand({
		name: `apps:${action}`, description: `${action} a registered app in a stopped maintenance process.`,
		parameters: [{ name: 'id', required: true }],
		/** Maps CLI input to the normal service action. */
		handle: parameters => (operation as typeof installApp)(parameters.id!),
	})),
];
