import type { AppNavigationBadge } from './AppNavigationBadge';

/** Browser-safe description of an app, shared by runtime, navigation and visual tools. */
export interface AppManifest {
	/** Stable lowercase identifier; also owns the database and route namespaces. */
	id: string;
	name: string;
	/** Stable semantic release version, for example 1.2.0. */
	version: string;
	description?: string;
	/** Plain text glyph or emoji. Render as text, never as HTML. */
	icon?: string;
	/** Public service contract generation, independent of package release version. */
	apiVersion?: number;
	/** Required app identifiers mapped to their exact public API generation. */
	requires?: Readonly<Record<string, number>>;
	/** Optional integrations; absent apps are allowed, incompatible installed apps are not. */
	optional?: Readonly<Record<string, number>>;
	/** Default destinations beneath /apps/{id}; a runtime navigation provider may replace these per viewer. */
	navigation?: readonly AppMenuItem[];
}

/** One app-owned navigation item; nesting is deliberately limited to one level. */
export interface AppMenuItem {
	id: string;
	label: string;
	/** Empty string opens the app's main view; otherwise a simple relative path. */
	path: string;
	badge?: AppNavigationBadge;
	/** Optional plain-text information about this destination. */
	description?: string;
}
