import type { AppNavigation } from './AppNavigation';

/** Browser-safe contributions for one viewer. Results are request-scoped and must not be cached across users. */
export interface AppNavigationResult {
	/** Registry-owned identity and public metadata attached to each successful contribution. */
	apps: Array<AppNavigation & { appId: string; name: string; icon?: string }>;
	/** Apps whose providers failed or returned invalid data. Their links are omitted without exposing error details. */
	unavailable: string[];
}
