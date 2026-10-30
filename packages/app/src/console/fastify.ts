import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FlowDefinition } from '../flows/contracts';
import { PassThrough } from 'node:stream';
import type { ConsoleAgents } from './ConsoleAgents';
import type { ConsoleDatabase } from './ConsoleDatabase';
import { ConsoleError } from './ConsoleError';
import type { ConsoleFlows } from './ConsoleFlows';
import type { ConsoleStorage } from './ConsoleStorage';
import type { ConsoleInfo, ConsoleReadOnly, ConsoleStorageChange, ConsoleTable } from './contracts';

/** Largest file the console uploads. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** What one console request works on: one app's database, storage and flows, as the host opened them. */
export interface ConsoleServices {
	/** Name shown in the console. */
	name: string;
	/** Environment shown in the console, such as `local` or `production`. */
	environment: string;
	/** The database, or why there is none. */
	database: ConsoleDatabase | { unavailable: string };
	/** The storage disks, or why there are none. */
	storage: ConsoleStorage | { unavailable: string };
	/** The flow definitions, or why there are none. */
	flows: ConsoleFlows | { unavailable: string };
	/** The app's agents, or why there are none. Left out, the Agents screens say this host has none. */
	agents?: ConsoleAgents | { unavailable: string };
	/**
	 * Why changes are refused here, such as in Production. `schema` covers definitions (table
	 * design, flows); `rows` covers data (rows and files). Leave one out to allow it.
	 */
	readOnly?: ConsoleReadOnly;
}

type TableParams = { table: string };

/**
 * Registers the console API (tables and rows, storage disks and files, flow definitions) in a
 * host's own server: Dock on this machine, db3 Cloud for deployed environments. Apps never serve
 * it themselves. The host decides who may call it and which app a request is for: `resolve`
 * returns that app's services, and should throw a 4xx error to refuse.
 *
 * @param server - The host's Fastify server or plugin scope.
 * @param prefix - Where the routes live, such as `/api/projects/:id/console`.
 * @param resolve - Opens the services for one request.
 */
export async function registerConsoleRoutes(server: FastifyInstance, prefix: string, resolve: (request: FastifyRequest) => Promise<ConsoleServices>): Promise<void> {
	await server.register(async scope => {
		scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_request, body, done) => done(null, body));
		scope.addHook('onRequest', async (_request, reply) => {
			reply.header('cache-control', 'no-store');
		});
		const database = async (request: FastifyRequest) => available((await resolve(request)).database);
		const storage = async (request: FastifyRequest) => available((await resolve(request)).storage);
		const flows = async (request: FastifyRequest) => available((await resolve(request)).flows);
		const agents = async (request: FastifyRequest) => available((await resolve(request)).agents ?? { unavailable: 'This console has no agents.' });
		/** Refuses a change of the given kind when the host made it read-only. */
		const writable = async (request: FastifyRequest, kind: keyof ConsoleReadOnly) => {
			const reason = (await resolve(request)).readOnly?.[kind];
			if (reason) throw new ConsoleError(reason, 403);
		};
		/** Marks tables read-only for the screens when rows can't be changed here. */
		const marked = async (request: FastifyRequest, table: ConsoleTable): Promise<ConsoleTable> => {
			const reason = (await resolve(request)).readOnly?.rows;
			return reason && !table.readOnly ? { ...table, readOnly: reason } : table;
		};
		scope.setErrorHandler((error, _request, reply) => {
			if (error instanceof ConsoleError) return reply.code(error.statusCode).send({ message: error.message });
			const status = (error as { statusCode?: number }).statusCode;
			if (status && status >= 400 && status < 500) return reply.code(status).send({ message: error instanceof Error ? error.message : 'That request was refused.' });
			const message = error instanceof Error ? error.message : String(error);
			// The database's own refusal is useful to the people allowed in; stack traces are not sent.
			if (/^ER_|Duplicate entry|cannot be null|Incorrect|foreign key/i.test(message) || (error as { code?: string }).code?.startsWith('ER_')) return reply.code(422).send({ message: message.replace(/^[^-]*- /, '').slice(0, 500) });
			return reply.code(500).send({ message: 'The console request failed. The log has the details.' });
		});

		scope.get('/', async (request): Promise<ConsoleInfo> => {
			const services = await resolve(request);
			const databaseReason = 'unavailable' in services.database ? services.database.unavailable : services.database.unavailableReason();
			const reason = (service: object) => 'unavailable' in service ? String(service.unavailable) : null;
			return {
				app: services.name,
				environment: services.environment,
				database: { available: !databaseReason, reason: databaseReason },
				storage: { available: !reason(services.storage), reason: reason(services.storage) },
				flows: { available: !reason(services.flows), reason: reason(services.flows), runs: false },
				agents: { available: !reason(services.agents ?? { unavailable: 'This console has no agents.' }), reason: reason(services.agents ?? { unavailable: 'This console has no agents.' }) },
				readOnly: { schema: services.readOnly?.schema ?? null, rows: services.readOnly?.rows ?? null },
			};
		});

		scope.get('/database/tables', async request => ({ tables: await Promise.all((await (await database(request)).tables()).map(table => marked(request, table))) }));
		scope.get<{ Params: TableParams; Querystring: { page?: string; limit?: string } }>('/database/tables/:table/rows', async request => {
			const page = await (await database(request)).rows(request.params.table, Number(request.query.page ?? 1), Number(request.query.limit ?? 25));
			return { ...page, table: await marked(request, page.table) };
		});
		scope.post<{ Params: TableParams; Body: { values?: unknown } }>('/database/tables/:table/rows', async (request, reply) => {
			await writable(request, 'rows');
			await (await database(request)).insert(request.params.table, request.body?.values);
			return reply.code(201).send({ ok: true });
		});
		scope.post<{ Params: TableParams; Body: { key?: unknown; values?: unknown } }>('/database/tables/:table/rows/update', async request => {
			await writable(request, 'rows');
			await (await database(request)).update(request.params.table, request.body?.key, request.body?.values);
			return { ok: true };
		});
		scope.post<{ Params: TableParams; Body: { key?: unknown } }>('/database/tables/:table/rows/delete', async request => {
			await writable(request, 'rows');
			await (await database(request)).delete(request.params.table, request.body?.key);
			return { ok: true };
		});
		scope.get<{ Params: TableParams; Querystring: { column?: string; q?: string; row?: string } }>('/database/tables/:table/options', async request => (await database(request)).options(request.params.table, request.query.column ?? '', { q: request.query.q, row: request.query.row }));

		scope.get('/storage/disks', async request => ({ disks: (await storage(request)).disks() }));
		scope.get<{ Querystring: { disk?: string; path?: string } }>('/storage', async request => (await storage(request)).list(request.query.disk ?? '', request.query.path ?? ''));
		scope.post<{ Body: ConsoleStorageChange }>('/storage/changes', async request => {
			await writable(request, 'rows');
			await (await storage(request)).change(checkedChange(request.body));
			return { ok: true };
		});
		scope.get<{ Querystring: { disk?: string; path?: string } }>('/storage/file', async (request, reply) => {
			const path = request.query.path ?? '';
			const file = await (await storage(request)).read(request.query.disk ?? '', path);
			const name = path.split('/').filter(Boolean).at(-1) ?? 'file';
			return reply.header('content-type', file.mimeType).header('content-length', file.size).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).header('x-content-type-options', 'nosniff').send(file.stream);
		});
		scope.put<{ Querystring: { disk?: string; path?: string }; Body: Buffer }>('/storage/file', { bodyLimit: MAX_UPLOAD_BYTES }, async (request, reply) => {
			await writable(request, 'rows');
			if (!Buffer.isBuffer(request.body)) throw new ConsoleError('Send the file as application/octet-stream.', 415);
			await (await storage(request)).write(request.query.disk ?? '', request.query.path ?? '', request.body);
			return reply.code(201).send({ ok: true });
		});

		scope.get('/flows', async request => {
			const service = await flows(request);
			return { flows: await service.listDefinitions(), blocks: service.blockMetadata() };
		});
		scope.get<{ Params: { id: string } }>('/flows/:id', async request => (await flows(request)).definition(request.params.id));
		scope.put<{ Params: { id: string }; Body: { definition: FlowDefinition; expectedRevision?: string; path?: string } }>('/flows/:id', async request => {
			await writable(request, 'schema');
			if (request.params.id !== request.body?.definition?.id) throw new ConsoleError('The flow id in the address must match the definition.', 400);
			return (await flows(request)).saveDefinition(request.body.definition, { expectedRevision: request.body.expectedRevision, path: request.body.path });
		});

		scope.get('/agents', async request => (await agents(request)).list());
		scope.put<{ Params: { name: string }; Body: { definition?: unknown; instructions?: string; expectedRevision?: string | null } }>('/agents/:name', async request => {
			await writable(request, 'schema');
			const definition = request.body?.definition as { name?: unknown } | undefined;
			if (!definition || definition.name !== request.params.name) throw new ConsoleError('The agent name in the address must match the definition.', 400);
			return (await agents(request)).save({ definition, instructions: String(request.body?.instructions ?? '') }, request.body?.expectedRevision ?? null);
		});
		scope.post<{ Params: { name: string }; Body: { message?: string; context?: Record<string, unknown>; conversationId?: string | null } }>('/agents/:name/runs', async (request, reply) => {
			const service = await agents(request);
			const message = String(request.body?.message ?? '').trim();
			if (!message) throw new ConsoleError('Write a message to send.', 400);
			const context = request.body?.context && typeof request.body.context === 'object' && !Array.isArray(request.body.context) ? request.body.context : {};
			// Events go out as JSON lines while the run happens; closing the request stops the run.
			const stream = new PassThrough();
			const abort = new AbortController();
			request.raw.on('close', () => { if (!stream.writableEnded) abort.abort(); });
			void service.run(request.params.name, { message, context, conversationId: request.body?.conversationId ?? null }, event => { stream.write(`${JSON.stringify(event)}\n`); }, abort.signal)
				.catch(error => { stream.write(`${JSON.stringify({ type: 'run.error', conversationId: null, aiRequestId: null, traceId: null, error: { message: error instanceof Error ? error.message : String(error) } })}\n`); })
				.finally(() => stream.end());
			return reply.type('application/x-ndjson').send(stream);
		});
		scope.get<{ Params: { name: string }; Querystring: { limit?: string } }>('/agents/:name/conversations', async request => ({ conversations: await (await agents(request)).conversations(request.params.name, Number(request.query.limit ?? 25)) }));
		scope.get<{ Params: { name: string } }>('/agents/:name/last-run', async request => ({ lastRun: await (await agents(request)).lastRun(request.params.name) }));
		scope.get<{ Params: { conversation: string } }>('/conversations/:conversation/messages', async request => ({ messages: await (await agents(request)).messages(request.params.conversation) }));
	}, { prefix });
}

/** A service the host opened, or a plain refusal saying why it has none. */
function available<T extends object>(service: T | { unavailable: string }): T {
	if ('unavailable' in service) throw new ConsoleError(service.unavailable, 404);
	return service;
}

/** Checks a storage change has the fields its action needs. */
function checkedChange(body: unknown): ConsoleStorageChange {
	const value = (body ?? {}) as Record<string, unknown>;
	if (typeof value.disk !== 'string' || typeof value.path !== 'string') throw new ConsoleError('Say which disk and path.', 400);
	if (value.action === 'mkdir' || value.action === 'delete') return { disk: value.disk, action: value.action, path: value.path };
	if (value.action === 'move' && typeof value.to === 'string') return { disk: value.disk, action: 'move', path: value.path, to: value.to };
	throw new ConsoleError('A change is mkdir, move (with to) or delete.', 400);
}

