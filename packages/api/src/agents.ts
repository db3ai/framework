import { z } from 'zod';
import { API_PREFIX, type ApiCaller, type ApiService } from './contracts';

/** Body of `POST /_db3/api/v1/agents/:agent/runs`. */
export const agentRunInput = z.strictObject({
	/** The message for the agent: text, or structured fields its definition declares. */
	input: z.union([z.string().min(1).max(100_000), z.record(z.string(), z.unknown())]),
	/** Continue an earlier conversation the caller may read; a new one is started when absent. */
	conversationId: z.string().min(1).max(64).optional(),
	/** Values for the agent's `{{context.x}}` placeholders. */
	context: z.record(z.string(), z.unknown()).optional(),
});
export type AgentRunInput = z.infer<typeof agentRunInput>;

export const AGENT_RUN_STATUS = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;

/** Answer to starting a run: 202, the work continues on the environment's queue. */
export const agentRunAccepted = z.strictObject({
	runId: z.string(),
	conversationId: z.string(),
	status: z.literal('queued'),
	/** True when an `Idempotency-Key` repeated an earlier request; the earlier run is returned. */
	duplicate: z.boolean(),
	links: z.strictObject({ self: z.string(), events: z.string() }),
});
export type AgentRunAccepted = z.infer<typeof agentRunAccepted>;

/** Answer to `GET /_db3/api/v1/agents/:agent/runs/:run`. */
export const agentRunState = z.strictObject({
	runId: z.string(),
	conversationId: z.string(),
	status: z.enum(AGENT_RUN_STATUS),
	/** The agent's final text once completed. */
	output: z.string().nullable(),
	error: z.string().nullable(),
});
export type AgentRunState = z.infer<typeof agentRunState>;

/**
 * The narrow port the agents API talks to. The framework adapts `app().ai` to it (queueing an
 * `AgentRunJob`, reading `ai_*` tables); tests pass a fake.
 */
export interface AgentRuns {
	/** The app's agent names (from `db3/agents` and `server/agents`). */
	names(): Promise<string[]>;
	/**
	 * Queues a run.
	 *
	 * @returns The run, or `null` when the agent does not exist or the conversation is not the caller's.
	 */
	start(agent: string, input: AgentRunInput, caller: ApiCaller, idempotencyKey?: string): Promise<{ runId: string; conversationId: string; duplicate: boolean } | null>;
	/**
	 * Reads a run.
	 *
	 * @returns The run, or `null` when it does not exist or this caller may not see it
	 * (an end user sees only runs they started; a secret key sees all).
	 */
	get(agent: string, runId: string, caller: ApiCaller): Promise<AgentRunState | null>;
}

/**
 * The agents part of the public API.
 *
 * - `POST /agents/:agent/runs` (route `run`) queues a run and answers 202.
 * - `GET /agents/:agent/runs/:run` (follows `run`) reads its state.
 * - Live events at `links.events` (Server-Sent Events, durable stream) come in the next contract.
 *
 * Exposed per agent in `db3/api.json`: `{ "services": { "agents": { "triage.run": "user" } } }`.
 */
export function agentsApi(runs: AgentRuns): ApiService {
	return {
		name: 'agents',
		resources: () => runs.names(),
		routes: () => [
			{
				name: 'run',
				method: 'POST',
				path: '/:agent/runs',
				resourceParam: 'agent',
				summary: 'Start an agent run. The work continues on the queue; follow it with the returned links.',
				input: agentRunInput,
				output: agentRunAccepted,
				async handle({ caller, params, input, idempotencyKey }) {
					const run = await runs.start(params.agent, input, caller, idempotencyKey);
					if (!run) return { status: 404, body: null };
					const self = `${API_PREFIX}/agents/${params.agent}/runs/${run.runId}`;
					return { status: 202, body: { ...run, status: 'queued' as const, links: { self, events: `${self}/events` } } };
				},
			},
			{
				name: 'read',
				method: 'GET',
				path: '/:agent/runs/:run',
				resourceParam: 'agent',
				accessFrom: 'run',
				summary: 'Read the state of a run this caller started.',
				input: z.strictObject({}),
				output: agentRunState,
				async handle({ caller, params }) {
					const run = await runs.get(params.agent, params.run, caller);
					return run ? { status: 200, body: run } : { status: 404, body: null };
				},
			},
		],
	};
}
