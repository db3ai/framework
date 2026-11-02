import type { z } from 'zod';
import type { ApiAccess, ApiConfig } from './config';

/** Where the API is served inside every environment. Cloud's router forwards here. */
export const API_PREFIX = '/_db3/api/v1';
/** Where Cloud reads what this build can expose. Secret key only. Served even while the API is disabled. */
export const API_MANIFEST_PATH = '/_db3/api/manifest';

/** Who is calling, after the key (and end user) checks passed. Handlers never see raw keys. */
export type ApiCaller =
	| { kind: 'secret'; keyId: string }
	| { kind: 'publishable'; keyId: string }
	| { kind: 'user'; keyId: string; userId: string };

/** What a route handler receives. */
export interface ApiRequest<Input> {
	caller: ApiCaller;
	/** Path parameters, such as `{ agent: 'triage' }`. */
	params: Record<string, string>;
	/** The body (or query for GET), already checked against the route's `input` schema. */
	input: Input;
	/** The `Idempotency-Key` header, when sent. */
	idempotencyKey?: string;
}

/** What a route handler answers. `null` body with status 404 means "not found for this caller". */
export interface ApiResponse<Output> {
	status: 200 | 201 | 202 | 404;
	body: Output | null;
}

/**
 * One route a service offers. The service owns its routes; the API package only checks
 * keys, origins, access and input, then calls `handle`.
 */
export interface ApiRoute<Input = unknown, Output = unknown> {
	/** Route name, used in `db3/api.json` as `<resource>.<name>`, such as `run`. */
	name: string;
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	/** Path under `<prefix>/<service>`, such as `/:agent/runs`. Its first parameter is the resource. */
	path: string;
	/** Path parameter whose value is the resource name in `db3/api.json`, such as `agent`. */
	resourceParam: string;
	/** Route whose access setting this route follows, when it is not its own (reading a run follows `run`). */
	accessFrom?: string;
	summary: string;
	input: z.ZodType<Input>;
	output: z.ZodType<Output>;
	handle(request: ApiRequest<Input>): Promise<ApiResponse<Output>>;
}

/** A framework service that delivers part of the API: agents, flows, tables, storage, auth. */
export interface ApiService {
	/** Service name, the first path segment and the key in `db3/api.json`, such as `agents`. */
	name: string;
	/** Resources the service has right now, such as the app's agent names, for the manifest. */
	resources(): Promise<string[]>;
	routes(): ApiRoute<any, any>[];
}

/** One route as Cloud sees it in the manifest. */
export interface ApiManifestRoute {
	name: string;
	method: ApiRoute['method'];
	/** Full path, such as `/_db3/api/v1/agents/triage/runs`. */
	path: string;
	access: ApiAccess;
	summary: string;
	/** JSON Schemas of the body and the answer, for Cloud's generated docs. */
	input: unknown;
	output: unknown;
}

/**
 * What this build can expose, merged with the current `db3/api.json`. Cloud reads it on every
 * deploy to draw the API tab (including routes that are off), configure its router and docs.
 */
export interface ApiManifest {
	version: 1;
	prefix: typeof API_PREFIX;
	enabled: boolean;
	origins: string[];
	services: Array<{ name: string; resources: Array<{ name: string; routes: ApiManifestRoute[] }> }>;
}

/** Keys the environment accepts. Cloud creates them and stores them as environment secrets. */
export interface ApiKeys {
	/** Secret keys (`db3_sk_…`). More than one while a key is being rotated. */
	secret: string[];
	/** Publishable keys (`db3_pk_…`). */
	publishable: string[];
}

/** Finds the signed-in end user of this app from a request, using the app's Auth service. */
export type ApiUserResolver = (headers: Record<string, string | string[] | undefined>) => Promise<string | null>;

/** Everything `registerApi` needs. Each is a narrow port, so tests and Dock can pass fakes. */
export interface ApiOptions {
	config: () => ApiConfig;
	keys: () => ApiKeys;
	services: ApiService[];
	users?: ApiUserResolver;
}

/** Answers for every refusal, so callers can rely on the shape. */
export interface ApiError {
	error: string;
	code: 'not_found' | 'unauthorized' | 'forbidden' | 'invalid_input' | 'rate_limited';
}
