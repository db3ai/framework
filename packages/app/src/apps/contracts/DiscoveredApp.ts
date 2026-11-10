import type { AppManifest } from './AppManifest';

/** Metadata-only discovery result; reading it does not import the app's server or browser code. */
export interface DiscoveredApp {
	manifest: AppManifest;
	directory: string;
	entry: string;
	client?: string;
	/** Absolute path of the manifest's `contract` file, when it declares one. */
	contract?: string;
	/** Direct npm dependency, absent for an in-project apps/{id} directory. */
	packageName?: string;
}
