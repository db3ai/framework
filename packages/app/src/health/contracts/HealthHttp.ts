import type { Health } from '../Health';

/** Minimal application shape required by the health HTTP adapter. */
export interface HealthApplication {
	/** Health service whose aggregate report is exposed over HTTP. */
	health: Health;
}

/** HTTP route configuration shared by supported server adapters. */
export interface HealthRouteOptions {
	/** Application that owns the health checks. */
	app: HealthApplication;

	/** Canonical endpoint path, defaulting to `/health`. */
	path?: string;

	/** Compatibility paths that return the same report. */
	aliases?: string[];
}
