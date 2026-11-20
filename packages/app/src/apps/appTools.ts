import { z } from 'zod';
import type { AppRoute, AppRouteRisk } from './contracts';

/** A route as `Apps.routes()` lists it: the app it belongs to and the route itself. */
export interface AppRouteEntry {
	appId: string;
	route: AppRoute<any>;
}

/** One route offered to AI agents as a tool, in the shape MCP's `tools/list` describes. */
export interface AppTool extends AppRouteEntry {
	name: string;
	description: string;
	inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
	annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean };
	/** Path parameters the agent gives; the rest come from its sign-in (`fixed`). */
	params: string[];
}

/** Chooses which routes become tools and how they are named. */
export interface AppToolOptions {
	/** Risks offered; defaults to `read`. A route without a risk or summary is never offered. */
	risks?: readonly AppRouteRisk[];
	/**
	 * Path parameters the host fills from the agent's sign-in, such as `organization`. They are left
	 * out of the tool's arguments and, with the word before them, out of its name.
	 */
	fixed?: readonly string[];
	/** Leaves out routes an agent must never call, such as managing its own sign-in. */
	include?(entry: AppRouteEntry): boolean;
}

/** Names of a route's path parameters, in order. */
export const routeParams = (path: string) => path.split('/').filter(part => part.startsWith(':')).map(part => part.slice(1));

/**
 * A tool's name from its route: the fixed words of its path joined with `_`, leaving out a word
 * followed by a fixed parameter. `GET /organizations/:organization/environments/:environment/runtime`
 * with `organization` fixed is `environments_runtime`; an app's root route is the app's id. Other
 * methods start with theirs, as `post_environments_rename`, so a path's read and change differ.
 */
export function appToolName(entry: AppRouteEntry, fixed: readonly string[] = []) {
	const parts = entry.route.path.split('/').filter(Boolean);
	const words = parts.filter((part, index) => !part.startsWith(':') && !(parts[index + 1]?.startsWith(':') && fixed.includes(parts[index + 1]!.slice(1))));
	const name = (words.join('_') || entry.appId).replace(/[^A-Za-z0-9_]/g, '_');
	return entry.route.method === 'GET' ? name : `${entry.route.method.toLowerCase()}_${name}`;
}

/** A schema's JSON Schema as a request sees it, without the draft marker tools don't need. */
export function inputJsonSchema(schema: z.ZodType): Record<string, unknown> {
	const { $schema: _draft, ...json } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
	return json;
}

/**
 * Routes as AI tools, made from the same table the HTTP router serves, so an agent can call exactly
 * what a person's browser calls, with the same checks. Arguments are the path parameters, `query`
 * for reads, `body` for changes (from the route's `input` schemas when it declares them) and, for
 * changes, `reason`: why the agent is making it, which `registerAppMcp` passes on as `actor.reason`.
 */
export function appTools(entries: readonly AppRouteEntry[], options: AppToolOptions = {}): AppTool[] {
	const risks = options.risks ?? ['read'];
	const fixed = options.fixed ?? [];
	const tools = entries.filter(entry => entry.route.risk && entry.route.summary && risks.includes(entry.route.risk) && (options.include?.(entry) ?? true)).map(entry => {
		const { route } = entry;
		const params = routeParams(route.path).filter(name => !fixed.includes(name));
		const declared = route.input?.params ? (inputJsonSchema(route.input.params).properties ?? {}) as Record<string, unknown> : {};
		const properties: Record<string, unknown> = Object.fromEntries(params.map(name => [name, declared[name] ?? { type: 'string', description: `The ${name}'s id.` }]));
		if (route.method === 'GET') properties.query = route.input?.query ? inputJsonSchema(route.input.query) : { type: 'object', additionalProperties: { type: 'string' }, description: 'Query string options the description names.' };
		else {
			properties.body = route.input?.body ? inputJsonSchema(route.input.body) : { type: 'object', description: 'The request body the description names.' };
			properties.reason = { type: 'string', maxLength: 500, description: 'Why you are making this change, for the people who review it.' };
		}
		const name = appToolName(entry, fixed);
		return {
			...entry, name, params, description: route.summary!,
			inputSchema: { type: 'object' as const, properties, required: params, additionalProperties: false as const },
			annotations: { title: name.replace(/_/g, ' '), readOnlyHint: route.risk === 'read' || route.risk === 'private', destructiveHint: route.risk === 'destructive' },
		};
	});
	const seen = new Map<string, AppTool>();
	for (const tool of tools) {
		const other = seen.get(tool.name);
		if (other) throw new Error(`Routes ${other.route.method} ${other.route.path} and ${tool.route.method} ${tool.route.path} would both be the tool ${tool.name}.`);
		seen.set(tool.name, tool);
	}
	return tools;
}
