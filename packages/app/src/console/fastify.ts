import { timingSafeEqual } from 'node:crypto';
import { basename } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FlowDefinition } from '../flows/contracts';
import type { Flows } from '../flows/Flows';
import type { App } from '../server/App';
import { ConsoleDatabase } from './ConsoleDatabase';
import { ConsoleError } from './ConsoleError';
import { ConsoleStorage } from './ConsoleStorage';
import type { ConsoleInfo, ConsoleStorageChange } from './contracts';

/** Where the console routes live on the app's own address. */
export const CONSOLE_PREFIX = '/_db3/console';
/** Largest file the console uploads. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Options for {@link registerConsoleRoutes}. */
export interface ConsoleRouteOptions {
	/** The app whose database and storage the console shows. */
	app: Pick<App, 'db' | 'storage' | 'directory'>;
	/**
	 * Bearer token callers must send. Without one, no routes are registered. Dock passes
	 * `DB3_CONSOLE_TOKEN` to the processes it starts; db3 Cloud sets it per environment.
	 */
	token: string | undefined;
	/** The app's flows, when it has them; the Flows screens appear only then. */
	flows?: Flows;
	/** The app's storage disk settings, to show each disk's driver. */
	disks?: Record<string, unknown>;
	/** Name shown in the console; defaults to the app folder's name. */
	name?: string;
	/** Environment shown in the console; defaults to NODE_ENV. */
	environment?: string;
}

type TableParams = { table: string };

/**
 * Registers the console API under `/_db3/console`: the app's tables and rows, its storage disks
 * and files, and its flow definitions. The same screens use it from Dock on localhost and from
 * db3 Cloud through the environment's agent. Every route needs the console token, so the routes
 * are safe to register in any environment; with no token they are not registered at all.
 *
 * @param server - The app's Fastify server.
 * @param options - App services, token and optional flows.
 * @returns Whether the routes were registered.
 */
export async function registerConsoleRoutes(server: FastifyInstance, options: ConsoleRouteOptions): Promise<boolean> {
	const token = options.token?.trim();
	if (!token) return false;
	const database = new ConsoleDatabase(options.app.db.knex, options.app.db.tableDirectory);
	const storage = new ConsoleStorage(options.app.storage, options.disks);
	const flows = options.flows ?? null;

	await server.register(async scope => {
		scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_request, body, done) => done(null, body));
		scope.addHook('onRequest', async (request, reply) => {
			if (!authorized(request, token)) return reply.code(401).header('cache-control', 'no-store').send({ message: 'The console token is missing or wrong.' });
			reply.header('cache-control', 'no-store');
		});
		scope.setErrorHandler((error, _request, reply) => {
			if (error instanceof ConsoleError) return reply.code(error.statusCode).send({ message: error.message });
			const status = (error as { statusCode?: number }).statusCode;
			if (status && status >= 400 && status < 500) return reply.code(status).send({ message: error instanceof Error ? error.message : 'That request was refused.' });
			const message = error instanceof Error ? error.message : String(error);
			// The console is a developer tool behind a token, so the database's own refusal is useful; stack traces are not sent.
			if (/^ER_|Duplicate entry|cannot be null|Incorrect|foreign key/i.test(message) || (error as { code?: string }).code?.startsWith('ER_')) return reply.code(422).send({ message: message.replace(/^[^-]*- /, '').slice(0, 500) });
			return reply.code(500).send({ message: 'The console request failed. The app log has the details.' });
		});

		scope.get('/', async (): Promise<ConsoleInfo> => {
			const databaseReason = database.unavailableReason();
			return {
				app: options.name ?? basename(options.app.directory),
				environment: options.environment ?? process.env.NODE_ENV ?? 'development',
				database: { available: !databaseReason, reason: databaseReason },
				storage: { available: true, reason: null },
				flows: { available: Boolean(flows), reason: flows ? null : 'This app does not load flows yet.', runs: false },
			};
		});

		scope.get('/database/tables', async () => ({ tables: await database.tables() }));
		scope.get<{ Params: TableParams; Querystring: { page?: string; limit?: string } }>('/database/tables/:table/rows', async request => database.rows(request.params.table, Number(request.query.page ?? 1), Number(request.query.limit ?? 25)));
		scope.post<{ Params: TableParams; Body: { values?: unknown } }>('/database/tables/:table/rows', async (request, reply) => {
			await database.insert(request.params.table, request.body?.values);
			return reply.code(201).send({ ok: true });
		});
		scope.post<{ Params: TableParams; Body: { key?: unknown; values?: unknown } }>('/database/tables/:table/rows/update', async request => {
			await database.update(request.params.table, request.body?.key, request.body?.values);
			return { ok: true };
		});
		scope.post<{ Params: TableParams; Body: { key?: unknown } }>('/database/tables/:table/rows/delete', async request => {
			await database.delete(request.params.table, request.body?.key);
			return { ok: true };
		});
		scope.get<{ Params: TableParams; Querystring: { column?: string; q?: string; row?: string } }>('/database/tables/:table/options', async request => database.options(request.params.table, request.query.column ?? '', { q: request.query.q, row: request.query.row }));

		scope.get('/storage/disks', async () => ({ disks: storage.disks() }));
		scope.get<{ Querystring: { disk?: string; path?: string } }>('/storage', async request => storage.list(request.query.disk ?? '', request.query.path ?? ''));
		scope.post<{ Body: ConsoleStorageChange }>('/storage/changes', async request => {
			await storage.change(checkedChange(request.body));
			return { ok: true };
		});
		scope.get<{ Querystring: { disk?: string; path?: string } }>('/storage/file', async (request, reply) => {
			const path = request.query.path ?? '';
			const file = await storage.read(request.query.disk ?? '', path);
			const name = path.split('/').filter(Boolean).at(-1) ?? 'file';
			return reply.header('content-type', file.mimeType).header('content-length', file.size).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).header('x-content-type-options', 'nosniff').send(file.stream);
		});
		scope.put<{ Querystring: { disk?: string; path?: string }; Body: Buffer }>('/storage/file', { bodyLimit: MAX_UPLOAD_BYTES }, async (request, reply) => {
			if (!Buffer.isBuffer(request.body)) throw new ConsoleError('Send the file as application/octet-stream.', 415);
			await storage.write(request.query.disk ?? '', request.query.path ?? '', request.body);
			return reply.code(201).send({ ok: true });
		});

		scope.get('/flows', async () => {
			const service = requireFlows(flows);
			return { flows: await service.listDefinitions(), blocks: service.blockMetadata() };
		});
		scope.get<{ Params: { id: string } }>('/flows/:id', async request => requireFlows(flows).definition(request.params.id));
		scope.put<{ Params: { id: string }; Body: { definition: FlowDefinition; expectedRevision?: string; path?: string } }>('/flows/:id', async request => {
			if (request.params.id !== request.body?.definition?.id) throw new ConsoleError('The flow id in the address must match the definition.', 400);
			return requireFlows(flows).saveDefinition(request.body.definition, { expectedRevision: request.body.expectedRevision, path: request.body.path });
		});
	}, { prefix: CONSOLE_PREFIX });

	return true;
}

/** Whether a request carries the console token, compared in constant time. */
function authorized(request: FastifyRequest, token: string): boolean {
	const header = request.headers.authorization ?? '';
	const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
	const expected = Buffer.from(token);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The app's flows, or a plain refusal when it has none. */
function requireFlows(flows: Flows | null): Flows {
	if (!flows) throw new ConsoleError('This app does not load flows yet.', 404);
	return flows;
}

/** Checks a storage change has the fields its action needs. */
function checkedChange(body: unknown): ConsoleStorageChange {
	const value = (body ?? {}) as Record<string, unknown>;
	if (typeof value.disk !== 'string' || typeof value.path !== 'string') throw new ConsoleError('Say which disk and path.', 400);
	if (value.action === 'mkdir' || value.action === 'delete') return { disk: value.disk, action: value.action, path: value.path };
	if (value.action === 'move' && typeof value.to === 'string') return { disk: value.disk, action: 'move', path: value.path, to: value.to };
	throw new ConsoleError('A change is mkdir, move (with to) or delete.', 400);
}

