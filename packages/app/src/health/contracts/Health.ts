/** Health states shared by aggregate reports and individual component checks. */
export type HealthStatus = 'ok' | 'degraded' | 'unhealthy';

/** Public-safe result returned by one named health check. */
export interface HealthCheckResult {
	/** Current component state. Unhealthy checks make the aggregate endpoint unavailable. */
	status: HealthStatus;

	/** Optional public-safe explanation suitable for an operator or external monitor. */
	message?: string;
}

/** Recorded result for one component in an aggregate health report. */
export interface HealthCheckReport extends HealthCheckResult {
	/** Time spent executing this check, rounded to milliseconds. */
	durationMs: number;
}

/** Complete application health report returned by the HTTP adapter. */
export interface HealthReport {
	/** Aggregate state derived from every registered component check. */
	status: HealthStatus;

	/** Stable service name configured by the application. */
	service: string;

	/** ISO timestamp recorded after all component checks complete. */
	timestamp: string;

	/** Results keyed by the stable names used when checks were registered. */
	checks: Record<string, HealthCheckReport>;
}

/** Function used to inspect one framework or application component. */
export type HealthCheck = () => HealthCheckResult | void | Promise<HealthCheckResult | void>;

/** Configuration accepted when the application health service is created. */
export interface HealthOptions {
	/** Stable service name included in every report. */
	service?: string;

	/** Maximum time allowed for each check, defaulting to 3,000 milliseconds. */
	timeoutMs?: number;

	/** Initial framework or application checks keyed by stable component name. */
	checks?: Record<string, HealthCheck>;
}
