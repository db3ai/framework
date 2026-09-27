import type { AppMenuItem } from './AppManifest';
import type { AppNavigationBadge } from './AppNavigationBadge';

/** One app's current navigation contribution. Return null from the provider to hide the app for this viewer. */
export interface AppNavigation {
	items: readonly AppMenuItem[];
	badge?: AppNavigationBadge;
	/** Short, plain-text information beneath the app's name. */
	description?: string;
}
