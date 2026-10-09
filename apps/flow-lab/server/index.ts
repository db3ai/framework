import 'dotenv/config';
import { pathToFileURL } from 'node:url';

import { RecordNotFoundError } from '@db3.ai/app/db';
import { FlowDefinitionConflictError, FlowDefinitionError, type FlowDefinition, type FlowReplayDefinition, type FlowValues } from '@db3.ai/app/flows';
import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import { registerHttpExchangeMonitor } from '@db3.ai/app/logging';
import { registerBrowserJsonFormatting } from '@db3.ai/app/server';

import { app, type App } from './app.js';
import { ensureDatabaseSchema } from './schema.js';

const port = Number(process.env.FLOW_LAB_API_PORT || process.env.API_PORT || process.env.PORT || 8788);
const host = process.env.FLOW_LAB_API_HOST || process.env.API_HOST || process.env.HOST || '127.0.0.1';

interface SaveFlowBody {
	definition: FlowDefinition;
	expectedRevision?: string;
	path?: string;
}

interface RunFlowBody {
	input: FlowValues;
}

interface ReplayFlowBody {
	definition?: FlowReplayDefinition;
	input?: FlowValues;
}

/**
 * Creates the isolated Flow Lab HTTP API over an application instance.
 *
 * @param runtimeApp - Flow Lab application to expose.
 * @returns Configured Fastify server.
 */
export async function createServer(runtimeApp: App = app()): Promise<FastifyInstance> {
	const server = Fastify({ loggerInstance: runtimeApp.log.logger as FastifyBaseLogger });
	registerBrowserJsonFormatting(server);
	registerHttpExchangeMonitor(server);

	await ensureDatabaseSchema(runtimeApp.db);
	void runtimeApp.flows;

	server.addHook('onSend', (_request, reply, _payload, done) => {
		reply.header('cache-control', 'no-store');
		done();
	});

	server.get('/api/health', async () => ({
		ok: true,
		app: 'flow-lab',
	}));

	server.get('/api/flows', async () => ({
		flows: await runtimeApp.flows.listDefinitions(),
		blocks: runtimeApp.flows.blockMetadata(),
	}));

	server.get<{ Params: { id: string } }>('/api/flows/:id', async request => {
		return await runtimeApp.flows.definition(request.params.id);
	});

	server.put<{ Params: { id: string }; Body: SaveFlowBody }>('/api/flows/:id', async request => {
		if (request.params.id !== request.body.definition.id) {
			throw new Error('Route flow id must match definition id.');
		}

		return await runtimeApp.flows.saveDefinition(request.body.definition, {
			expectedRevision: request.body.expectedRevision,
			path: request.body.path,
		});
	});

	server.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/flows/:id/runs', async request => ({
		runs: (await runtimeApp.flows.listRuns(request.params.id, Number(request.query.limit || 50)))
			.map(run => run.toJSON()),
	}));

	server.post<{ Params: { id: string }; Body: RunFlowBody }>('/api/flows/:id/runs', async (request, reply) => {
		const run = await runtimeApp.flows.run(request.params.id, request.body.input);

		reply.status(202);
		return { run: run.toJSON() };
	});

	server.get<{ Params: { id: string } }>('/api/flow-runs/:id', async request => {
		const details = await runtimeApp.flows.runDetails(request.params.id);

		return {
			run: details.run.toJSON(),
			steps: details.steps.map(step => step.toJSON()),
			events: details.events.map(event => event.toJSON()),
		};
	});

	server.post<{ Params: { id: string }; Body: ReplayFlowBody }>('/api/flow-runs/:id/replay', async (request, reply) => {
		const run = await runtimeApp.flows.replay(request.params.id, request.body);

		reply.status(202);
		return { run: run.toJSON() };
	});

	server.setErrorHandler((error, _request, reply) => {
		const message = error instanceof Error ? error.message : String(error);

		if (error instanceof FlowDefinitionConflictError) {
			reply.status(409).send({
				error: 'definition_conflict',
				message: error.message,
			});
			return;
		}

		if (error instanceof FlowDefinitionError) {
			reply.status(422).send({
				error: 'invalid_definition',
				message: error.message,
				issues: error.issues,
			});
			return;
		}

		if (error instanceof RecordNotFoundError || message.includes('was not found')) {
			reply.status(404).send({
				error: 'not_found',
				message,
			});
			return;
		}

		reply.status(500).send({
			error: 'server_error',
			message: process.env.NODE_ENV === 'production' ? 'Unexpected server error.' : message,
		});
	});

	server.addHook('onClose', async () => {
		await runtimeApp.close();
	});

	return server;
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
	const server = await createServer();

	await server.listen({ port, host });
	console.log(`Flow Lab API listening on http://${host}:${port}`);
}
