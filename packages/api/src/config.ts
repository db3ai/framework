import { z } from 'zod';

/** Where the app's API settings live in its repo. Cloud's API tab edits this file and commits it. */
export const API_CONFIG_FILE = 'db3/api.json';

/**
 * Who may call one route.
 *
 * - `off`: not served (answers 404, as if it did not exist). The default for every route.
 * - `secret`: server to server, with a secret key. Never from a browser.
 * - `publishable`: any caller holding the publishable key, such as a public website form.
 * - `user`: the publishable key plus a signed-in end user of this app.
 *
 * A secret key may call any route that is not `off`.
 */
export const API_ACCESS = ['off', 'secret', 'publishable', 'user'] as const;
export type ApiAccess = (typeof API_ACCESS)[number];

const access = z.enum(API_ACCESS);
const origin = z.string().regex(/^https?:\/\/[^/\s]+$/, 'An origin is a scheme and host, such as https://example.com, with no path.');

/** One service's routes: `{ "agents": { "triage.run": "user" } }`, keyed by `<resource>.<route>`. */
const serviceAccess = z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*\.[a-z][a-zA-Z]*$/, 'Use <resource>.<route>, such as triage.run.'), access);

const apiConfig = z.strictObject({
	/** Master switch. Off until someone turns the API on in Cloud. */
	enabled: z.boolean().default(false),
	/** Browser origins allowed to call with the publishable key. Calls with no Origin header are server calls. */
	origins: z.array(origin).default([]),
	/** Requests per minute per key (and per end user for `user` routes). */
	rateLimit: z.strictObject({ perMinute: z.number().int().min(1).max(100_000) }).default({ perMinute: 600 }),
	/** Exposure per service, keyed by service name. Anything not listed is `off`. */
	services: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), serviceAccess).default({}),
});

/** The parsed contents of `db3/api.json`. */
export type ApiConfig = z.infer<typeof apiConfig>;

/** What an app gets when it has no `db3/api.json`: the API is off. */
export const DEFAULT_API_CONFIG: ApiConfig = Object.freeze({ enabled: false, origins: [], rateLimit: { perMinute: 600 }, services: {} });

/**
 * Reads `db3/api.json`.
 *
 * @param value - The parsed JSON, or `undefined` when the file does not exist.
 * @returns The settings, with every missing value at its closed default.
 * @throws ZodError naming the bad field when the file is invalid; a bad file never opens the API.
 */
export function parseApiConfig(value: unknown): ApiConfig {
	if (value === undefined) return DEFAULT_API_CONFIG;
	return apiConfig.parse(value);
}

/**
 * Looks up who may call one route.
 *
 * @param config - The app's API settings.
 * @param service - Service name, such as `agents`.
 * @param resource - The thing inside the service, such as the agent name `triage`.
 * @param route - Route name, such as `run`.
 * @returns The access level; `off` when the API is disabled or the route is not listed.
 */
export function accessFor(config: ApiConfig, service: string, resource: string, route: string): ApiAccess {
	if (!config.enabled) return 'off';
	return config.services[service]?.[`${resource}.${route}`] ?? 'off';
}
