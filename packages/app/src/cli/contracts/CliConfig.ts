import type { App } from '../../server';
import type { CliCommand } from './CliCommand';

/** App-owned command registration exported by server/cli.config.ts. */
export interface CliConfig {
	/** Creates the app only when a command requests it; do not start an HTTP listener. */
	createApp?: () => App | Promise<App>;
	/** Commands exposed by configured services or by the application itself. */
	commands: readonly CliCommand[];
}
