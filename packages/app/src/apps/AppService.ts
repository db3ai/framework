import type { ActiveRecordClass } from '../db';
import type { QueueableJobClass } from '../queue';
import type { Schedule } from '../scheduler';
import type { App as HostApp } from '../server/App';
import type { AppNavigation, AppNavigationContext, AppRoute, AppStartContext } from './contracts';

/** Base for a discovered app's root App.ts. The instance is exposed as app().social, for example. */
export class AppService {
	static models: readonly ActiveRecordClass[] = [];
	static routes: readonly AppRoute<any>[] = [];
	static jobs: readonly QueueableJobClass[] = [];

	/** Receives the existing host; an installed app never creates a second framework runtime. */
	constructor(protected readonly host: HostApp) {}

	/** Computes navigation for this viewer. Undefined uses manifest links; null hides the app. Keep viewer data off this shared instance. */
	async navigation(_context: AppNavigationContext): Promise<AppNavigation | null | undefined> { return undefined; }

	/** Declares recurring work during boot. Delegate to the app's schedule.ts; declarations must be synchronous. */
	schedule(_schedule: Schedule): void {}

	/** Starts resources after dependencies are ready. Register cleanup immediately using context.defer. */
	async start(_context: AppStartContext<this>): Promise<void> {}

	/** Runs after migrations on every install or upgrade. Implementations must tolerate retries. */
	async install(): Promise<void> {}

	/** Checks and releases durable app-specific registrations. Database tables are retained by default. */
	async uninstall(): Promise<void> {}
}
