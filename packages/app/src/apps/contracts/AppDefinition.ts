import type { App } from '../../server/App';
import type { ActiveRecordClass } from '../../db';
import type { AppManifest } from './AppManifest';
import type { AppRoute } from './AppRoute';
import type { QueueableJobClass } from '../../queue';
import type { Schedule } from '../../scheduler';
import type { AppNavigation } from './AppNavigation';
import type { AppNavigationContext } from './AppNavigationContext';

/** Explicit contributions of one local or npm-distributed app. Importing it has no runtime effects. */
export interface AppDefinition<TService = unknown> {
	manifest: AppManifest;
	/** Creates one public service in the host runtime; never create a second framework App. */
	create(host: App): TService;
	/** App-owned models and immutable migration assets, resolved relative to the defining module. */
	database?: {
		models: readonly ActiveRecordClass[];
		/** Directory containing migrations/ and schema.snapshot.json, in source or a published package. */
		directory: URL;
	};
	/** Retry-safe app-owned setup after migrations have succeeded. */
	afterInstall?(host: App): void | Promise<void>;
	routes?: readonly AppRoute<TService>[];
	/** Serializable job classes with explicit names beneath this app's id, such as social.review. */
	jobs?: readonly QueueableJobClass[];
	/** Synchronously declares recurring work for the enabled app during each process boot. */
	schedule?(schedule: Schedule, service: TService): void;
	/** Computes viewer-specific navigation. Undefined uses manifest links; null hides the app. */
	navigation?(context: AppNavigationContext, service: TService): AppNavigation | null | undefined | Promise<AppNavigation | null | undefined>;
	/** Starts resources after dependency services exist. Use defer immediately for failure-safe cleanup. */
	start?(context: AppStartContext<TService>): void | Promise<void>;
	/** Checks app-specific outstanding work before uninstall; throwing leaves the installation intact. */
	beforeUninstall?(host: App): void | Promise<void>;
}

/** Resource ownership during startup. Cleanup runs in reverse registration order, including on failure. */
export interface AppStartContext<TService> {
	host: App;
	service: TService;
	defer(cleanup: () => void | Promise<void>): void;
}

/** Explicit host composition, keyed by the matching manifest identifier. */
export type AppDefinitions = Readonly<Record<string, AppDefinition<any>>>;

/** Optional public service types inferred from the host's actual composition. */
export type AppServices<TDefinitions extends AppDefinitions> = {
	readonly [K in keyof TDefinitions]: TDefinitions[K] extends AppDefinition<infer TService> ? TService | undefined : never;
};
