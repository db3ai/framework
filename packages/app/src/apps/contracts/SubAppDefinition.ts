import type { App } from '../../server/App';
import type { ActiveRecordClass } from '../../db';
import type { SubAppManifest } from './SubAppManifest';
import type { AppRoute } from './AppRoute';
import type { QueueableJobClass } from '../../queue';
import type { Schedule } from '../../scheduler';
import type { AppNavigation } from './AppNavigation';
import type { AppNavigationContext } from './AppNavigationContext';
import type { PluginScope } from './SubAppPlugin';

/** Explicit contributions of one local or npm-distributed app. Importing it has no runtime effects. */
export interface SubAppDefinition<TService = unknown> {
	manifest: SubAppManifest;
	/** Creates one public service in the main app; never create a second framework App. */
	create(app: App): TService;
	/** App-owned models and immutable migration assets, resolved relative to the defining module. */
	database?: {
		models: readonly ActiveRecordClass[];
		/** Directory containing migrations/ and schema.snapshot.json, in source or a published package. */
		directory: URL;
	};
	/** Retry-safe app-owned setup after migrations have succeeded. */
	afterInstall?(app: App): void | Promise<void>;
	routes?: readonly AppRoute<TService>[];
	/** Serializable job classes with explicit names beneath this app's id, such as social.review. */
	jobs?: readonly QueueableJobClass[];
	/** Synchronously declares recurring work for the enabled app during each process boot. */
	schedule?(schedule: Schedule, service: TService): void;
	/** Computes viewer-specific navigation. Undefined uses manifest links; null hides the app. */
	navigation?(context: AppNavigationContext, service: TService): AppNavigation | null | undefined | Promise<AppNavigation | null | undefined>;
	/** Starts resources after dependency services exist. Use defer immediately for failure-safe cleanup. */
	start?(context: SubAppStartContext<TService>): void | Promise<void>;
	/** A plugin's last word before it is activated; throw an AppRouteError to refuse, and nothing is saved. */
	activating?(scope: PluginScope, service: TService): void | Promise<void>;
	/** Runs after a plugin is activated for a scope, to start its work there. */
	activated?(scope: PluginScope, service: TService): void | Promise<void>;
	/** Runs after a plugin is deactivated for a scope, to stop its work there. Its data stays. */
	deactivated?(scope: PluginScope, service: TService): void | Promise<void>;
	/** Checks app-specific outstanding work before uninstall; throwing leaves the installation intact. */
	beforeUninstall?(app: App): void | Promise<void>;
}

/** Resource ownership during startup. Cleanup runs in reverse registration order, including on failure. */
export interface SubAppStartContext<TService> {
	app: App;
	service: TService;
	defer(cleanup: () => void | Promise<void>): void;
}

/** Explicit main app composition, keyed by the matching manifest identifier. */
export type SubAppDefinitions = Readonly<Record<string, SubAppDefinition<any>>>;

/** Optional public service types inferred from the main app's actual composition. */
export type SubAppServices<TDefinitions extends SubAppDefinitions> = {
	readonly [K in keyof TDefinitions]: TDefinitions[K] extends SubAppDefinition<infer TService> ? TService | undefined : never;
};
