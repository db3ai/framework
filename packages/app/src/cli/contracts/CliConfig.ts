import type { App } from '../../server';
import type { QueueSelection } from '../../queue/contracts';
import type { SchedulerCheckpoint, SchedulerWorkerOptions } from '../../scheduler/contracts';
import type { CliCommand } from './CliCommand';

/** App-owned command registration exported by server/cli.config.ts. */
export interface CliConfig {
	/** Creates the app only when a command requests it; do not start an HTTP listener. */
	createApp?: () => App | Promise<App>;
	/** Registers/boots operational definitions once; migrations and help do not call it. */
	prepareApp?: (application: App) => void | Promise<void>;
	/** Named pool admission used by framework queue commands. */
	queue?: { workers?: Readonly<Record<string, QueueSelection>> };
	/** Scheduler progress and health reporting owned by the application. */
	scheduler?: { checkpoint?: SchedulerCheckpoint; onTick?: SchedulerWorkerOptions['onTick'] };
	/** Commands exposed by configured services or by the application itself. */
	commands: readonly CliCommand[];
}
