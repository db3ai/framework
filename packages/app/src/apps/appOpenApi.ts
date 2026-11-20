import { APP_ROUTE_RISKS, type AppRouteRisk } from './contracts';
import { inputJsonSchema, routeParams, type AppRouteEntry, type AppTool } from './appTools';

type Json = Record<string, any>;

/** What the OpenAPI document says about itself and how its routes are grouped. */
export interface AppOpenApiOptions {
	info: { title: string; version: string; description?: string };
	/** Where the router is mounted; defaults to `/api/apps`, as `registerAppRoutes` serves it. */
	mount?: string;
	/** The tools offered to AI agents, so each route names its tool in `x-db3-tool`. */
	tools?: readonly AppTool[];
	/** The section a route is listed under; defaults to its app's id. */
	tag?(entry: AppRouteEntry): string;
}

/** A route's full path in OpenAPI form, such as `/api/apps/hello/notes/{note}`. */
export function appRoutePath(entry: AppRouteEntry, mount = '/api/apps') {
	const path = entry.route.path === '/' ? '' : entry.route.path;
	return `${mount}/${entry.appId}${path}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** A route's operation id, such as `getHelloNotesNote`: its method and path in camel case. */
const operationId = (entry: AppRouteEntry) => entry.route.method.toLowerCase() + [entry.appId, ...entry.route.path.split('/')].filter(Boolean)
	.map(part => part.replace(/^:/, '').split(/[^A-Za-z0-9]/).filter(Boolean).map(word => word[0]!.toUpperCase() + word.slice(1)).join('')).join('');

/**
 * An OpenAPI 3.1 document made from the route table the router serves, so the docs list every route
 * there is and none that isn't. Each operation has the route's summary, its risk in `x-db3-risk`,
 * its AI tool in `x-db3-tool`, and its parameters and body from the route's `input` schemas.
 */
export function appOpenApi(entries: readonly AppRouteEntry[], options: AppOpenApiOptions): Json {
	const tools = new Map(options.tools?.map(tool => [tool.route, tool.name]));
	const tagOf = options.tag ?? (entry => entry.appId);
	const paths: Json = {};
	for (const entry of entries) {
		const { route } = entry;
		const declared: Json = route.input?.params ? inputJsonSchema(route.input.params).properties ?? {} : {};
		const query = route.input?.query ? inputJsonSchema(route.input.query) : undefined;
		const parameters = [
			...routeParams(route.path).map(name => ({ name, in: 'path', required: true, schema: declared[name] ?? { type: 'string' } })),
			...Object.entries((query?.properties ?? {}) as Json).map(([name, schema]) => ({ name, in: 'query', required: (query?.required as string[] | undefined)?.includes(name) ?? false, schema })),
		];
		const path = appRoutePath(entry, options.mount);
		paths[path] ??= {};
		paths[path][route.method.toLowerCase()] = {
			operationId: operationId(entry),
			tags: [tagOf(entry)],
			...(route.summary ? { summary: route.summary } : {}),
			...(route.risk ? { 'x-db3-risk': route.risk } : {}),
			...(tools.has(route) ? { 'x-db3-tool': tools.get(route) } : {}),
			...(parameters.length ? { parameters } : {}),
			...(route.input?.body ? { requestBody: { required: true, content: { 'application/json': { schema: inputJsonSchema(route.input.body) } } } } : {}),
			responses: { [String(route.status ?? 200)]: { description: 'Done' }, default: { $ref: '#/components/responses/Error' } },
		};
	}
	const risks = Object.entries(APP_ROUTE_RISKS).map(([risk, text]) => `\`${risk as AppRouteRisk}\`: ${text}`).join(' ');
	return {
		openapi: '3.1.0',
		info: { ...options.info, description: [options.info.description, `Each route says how much a call can change in \`x-db3-risk\`. ${risks}`].filter(Boolean).join('\n\n') },
		tags: [...new Set(entries.map(tagOf))].map(name => ({ name })),
		paths,
		components: { responses: { Error: { description: 'Refused, with `{ message }` saying why', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } } } } } },
	};
}
