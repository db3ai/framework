import type { SubAppManifest } from './SubAppManifest';
import type { ScheduledTaskDefinition } from '../../scheduler';

/** Durable installation state. Enabled installations become available only after a successful boot. */
export type SubAppInstallationState = 'enabled' | 'disabled' | 'uninstalled' | 'failed';

/** Inspectable app structure without constructors, secrets or filesystem paths. */
export interface SubAppDescription {
	manifest: SubAppManifest;
	registered: boolean;
	state: SubAppInstallationState | 'available';
	ready: boolean;
	installedVersion: string | null;
	models: { name: string; table: string }[];
	routes: { method: string; path: string }[];
	/** Stable durable job names owned by this app. */
	jobs: string[];
	/** Runtime declarations collected during boot; empty before the first boot. */
	schedules: ScheduledTaskDefinition[];
}

/** Browser renderer contract. The host supplies its own component type and routing implementation. */
export interface SubAppClientDefinition<TComponent> {
	id: string;
	/** Statically discoverable lazy import, allowing bundlers to keep server code out of browser assets. */
	load(): Promise<{ default: TComponent }>;
}
