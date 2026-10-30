import type { AgentDescription } from '@db3.ai/app/console';

/** The fields of an agent the Definition tab edits. */
export interface AgentForm {
	name: string;
	title: string;
	description: string;
	model: string;
	maxTurns: string;
	reasoningEffort: string;
	instructions: string;
	context: { name: string; description: string }[];
	tools: string[];
}

/** One entry in the playground's transcript. */
export type PlaygroundItem =
	| { kind: 'user'; text: string }
	| { kind: 'assistant'; text: string; done: boolean }
	| { kind: 'tool'; id: string; name: string; state: 'calling' | 'done' | 'failed'; detail: string }
	| { kind: 'error'; text: string };

/** Fields a defined agent can edit, in the order the screen shows them. */
export const AGENT_FIELDS = ['title', 'description', 'model', 'maxTurns', 'reasoningEffort', 'context', 'instructions', 'tools'] as const;

/** Labels for each kind of agent, in plain words. */
export function kindLabel(kind: AgentDescription['kind']): string {
	return { files: 'Defined', code: 'Code', 'files+code': 'Defined + code', class: 'Class' }[kind];
}

/** Whether one part of an agent can be changed here: it has files, and code doesn't set it. */
export function canEdit(agent: AgentDescription | null, field: (typeof AGENT_FIELDS)[number]): boolean {
	if (!agent || !agent.path) return false;
	return !agent.overrides.includes(field);
}

/** The form for an agent, or a new one. */
export function formFor(agent: AgentDescription | null, name = ''): AgentForm {
	return {
		name: agent?.name ?? name,
		title: agent?.title ?? '',
		description: agent?.description ?? '',
		model: agent?.model ?? '',
		maxTurns: agent?.maxTurns ? String(agent.maxTurns) : '',
		reasoningEffort: agent?.reasoningEffort ?? '',
		instructions: agent?.instructions ?? '',
		context: (agent?.context ?? []).map(field => ({ name: field.name, description: field.description ?? '' })),
		tools: [...(agent?.tools ?? [])],
	};
}

/** Turns the form into the `agent.json` definition the host saves; empty fields are left out. */
export function definitionFrom(form: AgentForm): Record<string, unknown> {
	const maxTurns = Number(form.maxTurns);
	return {
		version: 1,
		name: form.name.trim(),
		...(form.title.trim() ? { title: form.title.trim() } : {}),
		...(form.description.trim() ? { description: form.description.trim() } : {}),
		...(form.model.trim() ? { model: form.model.trim() } : {}),
		...(form.maxTurns.trim() && Number.isInteger(maxTurns) ? { maxTurns } : {}),
		...(form.reasoningEffort ? { reasoningEffort: form.reasoningEffort } : {}),
		context: form.context.filter(field => field.name.trim()).map(field => ({ name: field.name.trim(), ...(field.description.trim() ? { description: field.description.trim() } : {}) })),
		tools: form.tools.map(name => ({ kind: 'function', name })),
	};
}

/** A folder name for a new agent from what someone typed: lower case, dashes, nothing else. */
export function agentName(text: string): string {
	return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 63);
}

/**
 * Adds one streamed event to the playground transcript and returns the conversation it belongs
 * to, so the next message continues it.
 */
export function applyEvent(items: PlaygroundItem[], event: Record<string, unknown>): string | null {
	const type = String(event.type ?? '');
	const last = items.at(-1);
	if (type === 'text.delta') {
		if (last?.kind === 'assistant' && !last.done) last.text += String(event.delta ?? '');
		else items.push({ kind: 'assistant', text: String(event.delta ?? ''), done: false });
	} else if (type === 'message.completed') {
		if (last?.kind === 'assistant' && !last.done) { last.text = String(event.content ?? last.text); last.done = true; }
		else items.push({ kind: 'assistant', text: String(event.content ?? ''), done: true });
	} else if (type === 'tool.calling') {
		items.push({ kind: 'tool', id: String(event.id ?? ''), name: String(event.toolName ?? ''), state: 'calling', detail: brief(event.arguments) });
	} else if (type === 'tool.success' || type === 'tool.error') {
		const tool = items.find((item): item is Extract<PlaygroundItem, { kind: 'tool' }> => item.kind === 'tool' && item.id === String(event.id ?? ''));
		const detail = type === 'tool.success' ? brief(event.result) : brief((event.error as { message?: unknown } | undefined)?.message ?? event.error);
		if (tool) { tool.state = type === 'tool.success' ? 'done' : 'failed'; tool.detail = detail; }
		else items.push({ kind: 'tool', id: String(event.id ?? ''), name: String(event.toolName ?? ''), state: type === 'tool.success' ? 'done' : 'failed', detail });
	} else if (type === 'run.error') {
		items.push({ kind: 'error', text: String((event.error as { message?: unknown } | undefined)?.message ?? 'The run failed.') });
	}
	return typeof event.conversationId === 'string' && event.conversationId ? event.conversationId : null;
}

/** A short one-line form of a tool's arguments or result. */
function brief(value: unknown): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
	return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/** Money as the console shows it. */
export function costText(value: number | null): string {
	if (value === null) return '—';
	return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}
