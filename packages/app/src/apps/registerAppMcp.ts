import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Apps } from './Apps';
import type { AppTool } from './appTools';
import { AppRouteError } from './AppRouteError';
import { callAppRoute } from './callAppRoute';

/** The MCP versions served, newest first; a client asking for another gets the newest. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'];

/** Who an agent is, as the host's sign-in decides it. */
export interface AppMcpCaller {
	/** Passed to routes as their actor, with the tool's `reason` added for changes. */
	actor: { id: string } & Record<string, unknown>;
	/** Path parameters the sign-in decides, such as the organization a key belongs to. */
	params?: Record<string, string>;
}

/** How the MCP server introduces itself, signs agents in and what it offers. */
export interface AppMcpOptions {
	/** Where it is served; defaults to `/mcp`. */
	path?: string;
	serverInfo: { name: string; title: string; version: string };
	/** Guidance an agent gets when it connects. */
	instructions?: string;
	/** From `appTools`; only these can be called. */
	tools: readonly AppTool[];
	/**
	 * The origin of the host's own pages. Browsers send `Origin`, so a call carrying any other is
	 * refused, keeping web pages from reaching the server through a visitor's network.
	 */
	origin: string;
	/** Signs the agent in from its request; throw `AppRouteError(401, …)` to refuse. Never accept cookies. */
	authorize(request: FastifyRequest): Promise<AppMcpCaller>;
	/** A tool answer longer than this many characters is cut; defaults to 200,000. */
	maxText?: number;
}

type JsonRpcId = string | number | null;
interface JsonRpcRequest { jsonrpc?: unknown; id?: JsonRpcId; method?: unknown; params?: Record<string, unknown> }

const answer = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0', id, result });
const failure = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const refused = (text: string) => ({ isError: true, content: [{ type: 'text', text }] });

/**
 * Serves app routes as an MCP server (Streamable HTTP, stateless, JSON answers). Each tool call runs
 * its route's handler through the same input checks as HTTP, inside `apps.run`, for the actor the
 * host's `authorize` returns. Failures a route reports with `AppRouteError` come back as tool errors
 * the agent can read; anything else stays private and fails the request.
 */
export function registerAppMcp(server: FastifyInstance, apps: Apps<any>, options: AppMcpOptions): void {
	const path = options.path ?? '/mcp';
	const maxText = options.maxText ?? 200_000;
	const byName = new Map(options.tools.map(tool => [tool.name, tool]));
	const listed = options.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }));

	/** Runs one tool, as `tools/call` answers it. */
	async function call(caller: AppMcpCaller, name: unknown, args: unknown) {
		const tool = typeof name === 'string' ? byName.get(name) : undefined;
		if (!tool) return refused(`There is no tool called ${String(name)}.`);
		const input = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
		const params: Record<string, string> = { ...caller.params };
		for (const key of tool.params) {
			const value = input[key];
			if (typeof value !== 'string' || !value || value.length > 200 || value.includes('/')) return refused(`Give ${key} as an id.`);
			params[key] = value;
		}
		// A declared body schema sees the agent's value as it is, as it would over HTTP.
		const object = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
		const actor = typeof input.reason === 'string' && tool.route.method !== 'GET' ? { ...caller.actor, reason: input.reason.slice(0, 500) } : caller.actor;
		try {
			const result = await apps.run(async () => {
				const service = apps.get(tool.appId);
				if (service === undefined) throw new AppRouteError(404, 'App is unavailable.');
				return callAppRoute(tool.route, { service, actor, params, query: object(input.query), body: tool.route.method === 'GET' ? {} : tool.route.input?.body ? input.body : object(input.body) });
			});
			const text = JSON.stringify(result ?? null);
			return { content: [{ type: 'text', text: text.length > maxText ? `${text.slice(0, maxText)}\n…cut at ${maxText} characters; narrow the query.` : text }] };
		} catch (error) {
			if (error instanceof AppRouteError) return refused(error.message);
			throw error;
		}
	}

	server.post(path, { bodyLimit: 1_000_000 }, async (request, reply) => {
		if (request.headers.origin && request.headers.origin !== options.origin) return reply.code(403).send(failure(null, -32600, 'This MCP server takes no calls from web pages.'));
		let caller: AppMcpCaller;
		try { caller = await options.authorize(request); }
		catch (error) {
			if (!(error instanceof AppRouteError)) throw error;
			return reply.code(error.statusCode === 403 ? 403 : 401).header('www-authenticate', 'Bearer').send(failure(null, -32001, error.message));
		}
		const message = request.body as JsonRpcRequest;
		if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return reply.code(400).send(failure(null, -32600, 'Send one JSON-RPC 2.0 request.'));
		if (message.id === undefined) return reply.code(202).send();
		const id = message.id;
		switch (message.method) {
			case 'initialize': {
				const asked = message.params?.protocolVersion;
				return answer(id, {
					protocolVersion: typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
					capabilities: { tools: { listChanged: false } },
					serverInfo: options.serverInfo,
					...(options.instructions ? { instructions: options.instructions } : {}),
				});
			}
			case 'ping': return answer(id, {});
			case 'tools/list': return answer(id, { tools: listed });
			case 'tools/call': return answer(id, await call(caller, message.params?.name, message.params?.arguments));
			default: return failure(id, -32601, `There is no method ${message.method}.`);
		}
	});
	/** No server-sent stream: every answer comes back on its own POST. */
	server.get(path, async (_request, reply) => reply.code(405).header('allow', 'POST').send());
}
