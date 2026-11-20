import type { ZodType } from 'zod';
import type { AppRouteRisk } from './AppRouteRisk';

/** Transport-neutral authenticated request passed to an app-owned route. */
export interface AppRouteContext<TService> {
	service: TService;
	/**
	 * Identity established by the host adapter; never taken from a request body. The adapter's
	 * authorize result is passed through as it is, so a host can add who called and how.
	 */
	actor: { id: string };
	/** The request body; parsed by `input.body` when the route declares it. */
	body: unknown;
	/** Named path segments; parsed by `input.params` when the route declares it. */
	params: Readonly<Record<string, string>>;
	/** The query string; parsed by `input.query` when the route declares it. */
	query: Readonly<Record<string, unknown>>;
}

/**
 * What a route accepts. Each schema checks the request before `handle` runs, so a bad call is
 * refused with 400 and the reason, and the same schema becomes the route's documented input and
 * its AI tool's arguments.
 */
export interface AppRouteInput {
	params?: ZodType;
	query?: ZodType;
	body?: ZodType;
}

/** One route mounted beneath /api/apps/{appId}; authorization remains mandatory in the adapter. */
export interface AppRoute<TService = unknown> {
	method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	path: string;
	/** HTTP success status; defaults to 200. */
	status?: number;
	/**
	 * What the route does, in one sentence. It is the route's line in the generated API reference
	 * and OpenAPI document, and its AI tool's description.
	 */
	summary?: string;
	/** How much a call can change; decides which routes AI tools may offer. See {@link AppRouteRisk}. */
	risk?: AppRouteRisk;
	/** Schemas the router checks before `handle` runs; also documented. See {@link AppRouteInput}. */
	input?: AppRouteInput;
	handle(context: AppRouteContext<TService>): unknown | Promise<unknown>;
}
