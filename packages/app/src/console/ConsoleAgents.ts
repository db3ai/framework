import type { AgentDefinition } from '../ai/defined/AgentDefinition';
import type { AgentStreamEvent } from '../ai/contracts/AgentProtocol';
import type { AgentDescription } from '../cli/commands/agents';
import type { ConsoleExecutor } from './ConsoleDatabase';

export type { AgentDescription };

/** A function tool agents can use, as the console lists it. */
export interface ConsoleAgentTool {
	name: string;
	title: string;
	description: string;
	/** JSON Schema of its arguments. */
	parameters: unknown;
}

/** One recent conversation with an agent. */
export interface ConsoleConversation {
	id: string;
	title: string | null;
	user: string | null;
	messages: number;
	costUSD: number | null;
	createdAt: string;
	updatedAt: string;
}

/** One message in a conversation, as text. */
export interface ConsoleMessage {
	id: string;
	role: string;
	content: string | null;
	toolName: string | null;
	toolState: string | null;
	model: string | null;
	createdAt: string;
}

/** What an agent was last sent, read from the request log: the parts code builds at run time. */
export interface ConsoleLastRun {
	aiRequestId: string;
	model: string | null;
	instructions: string | null;
	tools: string[];
	createdAt: string;
}

/** What the console's Agents screens need from a host. */
export interface ConsoleAgents {
	/** Every agent and the function tools they can use. */
	list(): Promise<{ agents: AgentDescription[]; tools: ConsoleAgentTool[] }>;
	/** Saves an agent's files; null `expectedRevision` makes a new one. */
	save(input: { definition: AgentDefinition | unknown; instructions: string }, expectedRevision: string | null): Promise<{ revision: string; path: string }>;
	/** Runs one message through an agent, passing each event on as it happens. */
	run(name: string, input: { message: string; context?: Record<string, unknown>; conversationId?: string | null }, emit: (event: AgentStreamEvent | Record<string, unknown>) => void, signal?: AbortSignal): Promise<void>;
	/** Recent conversations with an agent, newest first. */
	conversations(name: string, limit?: number): Promise<ConsoleConversation[]>;
	/** One conversation's messages, in order. */
	messages(conversationId: string): Promise<ConsoleMessage[]>;
	/** The latest request an agent sent, or null when it hasn't run. */
	lastRun(name: string): Promise<ConsoleLastRun | null>;
}

/**
 * Reads agent conversations and request logs from an app's own tables (`ai_conversations`,
 * `ai_messages`, `ai_requests`) through the same executor as the Database screen, so it works
 * in Dock and over Cloud's agent tunnel alike.
 */
export class ConsoleAgentLogs {
	/** @param executor - Runs SQL against the app's database. */
	constructor(private readonly executor: ConsoleExecutor) {}

	/** Recent conversations with one agent, with message counts and recorded cost. */
	async conversations(name: string, limit = 25): Promise<ConsoleConversation[]> {
		const size = Math.min(100, Math.max(1, Math.floor(limit)));
		const { rows } = await this.executor.run(
			`SELECT c.id, c.title, c.user_id, c.created_at, c.updated_at,
				(SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS message_count,
				(SELECT SUM(r.cost_usd) FROM ai_requests r WHERE r.conversation_id = c.id) AS cost
			FROM ai_conversations c WHERE c.agent = ? ORDER BY c.updated_at DESC, c.id DESC LIMIT ${size}`,
			[name],
		).catch(missingTables);
		return rows.map(row => ({
			id: String(row.id), title: text(row.title), user: text(row.user_id),
			messages: Number(row.message_count ?? 0), costUSD: row.cost === null || row.cost === undefined ? null : Number(row.cost),
			createdAt: time(row.created_at), updatedAt: time(row.updated_at),
		}));
	}

	/** One conversation's messages, in order. */
	async messages(conversationId: string): Promise<ConsoleMessage[]> {
		const { rows } = await this.executor.run(
			'SELECT id, role, content, tool_name, tool_state, model, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY sequence, created_at, id LIMIT 500',
			[conversationId],
		).catch(missingTables);
		return rows.map(row => ({ id: String(row.id), role: String(row.role), content: text(row.content), toolName: text(row.tool_name), toolState: text(row.tool_state), model: text(row.model), createdAt: time(row.created_at) }));
	}

	/** The instructions, tools and model an agent last sent to its provider, from the request log. */
	async lastRun(name: string): Promise<ConsoleLastRun | null> {
		const { rows } = await this.executor.run(
			`SELECT r.id, r.model, r.request, r.created_at FROM ai_requests r JOIN ai_conversations c ON c.id = r.conversation_id
			WHERE c.agent = ? AND r.request LIKE '%"instructions"%' ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
			[name],
		).catch(missingTables);
		const row = rows[0];
		if (!row) return null;
		let request: { instructions?: unknown; tools?: unknown[] } = {};
		try { request = typeof row.request === 'string' ? JSON.parse(row.request) : (row.request as typeof request) ?? {}; } catch { request = {}; }
		return {
			aiRequestId: String(row.id), model: text(row.model),
			instructions: typeof request.instructions === 'string' ? request.instructions : null,
			tools: Array.isArray(request.tools) ? request.tools.map(item => typeof item === 'string' ? item : String((item as { name?: unknown } | null)?.name ?? '')).filter(Boolean) : [],
			createdAt: time(row.created_at),
		};
	}
}

/** An app that has never set up AI has no conversation tables yet: that reads as no conversations. */
function missingTables(error: unknown): { rows: Record<string, unknown>[]; affectedRows: number } {
	if (/ER_NO_SUCH_TABLE|doesn't exist/i.test(String((error as { code?: string })?.code ?? '') + String((error as Error)?.message ?? ''))) return { rows: [], affectedRows: 0 };
	throw error;
}

function text(value: unknown): string | null {
	return value === null || value === undefined ? null : String(value);
}

function time(value: unknown): string {
	if (value instanceof Date) return value.toISOString();
	return value === null || value === undefined ? '' : String(value);
}
