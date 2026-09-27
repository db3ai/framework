import type * as health from './contracts';

const STATUS_PRIORITY: Record<health.HealthStatus, number> = {
	ok: 0,
	degraded: 1,
	unhealthy: 2,
};

/** Aggregates framework and application component checks into one safe report. */
export class Health {
	readonly #service: string;
	readonly #timeoutMs: number;
	readonly #checks = new Map<string, health.HealthCheck>();

	/**
	 * Creates an application health registry with the framework runtime check.
	 *
	 * @param options - Service identity and initial application checks.
	 */
	constructor(options: health.HealthOptions = {}) {
		this.#service = options.service?.trim() || 'application';
		this.#timeoutMs = positiveTimeout(options.timeoutMs);
		this.register('application', () => ({ status: 'ok' }));

		for (const [name, check] of Object.entries(options.checks ?? {})) {
			this.register(name, check);
		}
	}

	/**
	 * Registers or replaces one named component check.
	 *
	 * Stable names let applications override a framework default without
	 * producing duplicate output.
	 *
	 * @param name - Public component name used as the report key.
	 * @param check - Bounded check that returns only public-safe details.
	 * @returns This health service for fluent registration.
	 */
	register(name: string, check: health.HealthCheck): this {
		const normalized = normalizeCheckName(name);

		if (typeof check !== 'function') throw new TypeError(`Health check "${normalized}" must be a function.`);
		this.#checks.set(normalized, check);
		return this;
	}

	/**
	 * Removes one optional component check.
	 *
	 * The framework-owned application check cannot be removed because it makes
	 * the default endpoint useful without any application configuration.
	 *
	 * @param name - Registered component name.
	 * @returns Whether an application-owned check was removed.
	 */
	remove(name: string): boolean {
		const normalized = normalizeCheckName(name);
		if (normalized === 'application') return false;
		return this.#checks.delete(normalized);
	}

	/**
	 * Executes all checks concurrently and returns a public-safe aggregate.
	 *
	 * Thrown values are contained and converted to a generic unhealthy result;
	 * applications must log diagnostic details inside their check when needed.
	 *
	 * @returns Current aggregate and per-component health state.
	 */
	async report(): Promise<health.HealthReport> {
		const entries = await Promise.all(
			[...this.#checks.entries()].map(async ([name, check]) => {
				const startedAt = performance.now();
				let result: health.HealthCheckResult;

				try {
					result = normalizeCheckResult(await withTimeout(check(), this.#timeoutMs));
				} catch {
					result = { status: 'unhealthy', message: 'Health check failed.' };
				}

				return [name, {
					...result,
					durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
				}] as const;
			}),
		);
		const checks = Object.fromEntries(entries);
		const status = entries.reduce<health.HealthStatus>((current, [, result]) => {
			return STATUS_PRIORITY[result.status] > STATUS_PRIORITY[current] ? result.status : current;
		}, 'ok');

		return {
			status,
			service: this.#service,
			timestamp: new Date().toISOString(),
			checks,
		};
	}
}

/**
 * Normalizes and validates a public component name.
 *
 * @param name - Caller-supplied check name.
 * @returns Trimmed stable report key.
 */
function normalizeCheckName(name: string): string {
	const normalized = name.trim();
	if (!normalized) throw new TypeError('Health check names cannot be empty.');
	return normalized;
}

/**
 * Applies the healthy default and validates a component result.
 *
 * @param result - Value returned by a registered health check.
 * @returns Validated public-safe component result.
 */
function normalizeCheckResult(result: health.HealthCheckResult | void): health.HealthCheckResult {
	if (result === undefined) return { status: 'ok' };
	if (!Object.hasOwn(STATUS_PRIORITY, result.status)) throw new TypeError(`Unsupported health status "${String(result.status)}".`);

	return result.message
		? { status: result.status, message: result.message }
		: { status: result.status };
}

/**
 * Resolves the bounded per-check timeout.
 *
 * @param timeoutMs - Optional application override.
 * @returns Positive timeout in milliseconds.
 */
function positiveTimeout(timeoutMs: number | undefined): number {
	if (timeoutMs === undefined) return 3000;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Health timeoutMs must be a positive number.');
	return timeoutMs;
}

/**
 * Prevents a stuck dependency from hanging the aggregate health endpoint.
 *
 * @param result - Check result or promise returned by the application.
 * @param timeoutMs - Maximum time allowed for the check.
 * @returns Check result before the timeout expires.
 */
async function withTimeout(result: ReturnType<health.HealthCheck>, timeoutMs: number): Promise<health.HealthCheckResult | void> {
	let timer: NodeJS.Timeout | undefined;

	try {
		return await Promise.race([
			Promise.resolve(result),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error('Health check timed out.')), timeoutMs);
				timer.unref();
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
