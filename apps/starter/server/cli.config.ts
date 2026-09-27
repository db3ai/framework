import type { CliConfig } from '@db3.ai/app/cli';
import { databaseCommands } from '@db3.ai/app/db/commands';
import { appsCommands } from '@db3.ai/app/apps/commands';
import { createApplication } from './app';
import { readConfig } from './config';

/** App configuration for the framework CLI; service modules own command execution. */
export default {
	/** Creates the same app used by HTTP, without starting a listener. */
	createApp: () => createApplication(readConfig()),
	commands: [...databaseCommands, ...appsCommands],
} satisfies CliConfig;
