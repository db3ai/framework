<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AgentDescription, ConsoleAgentTool, ConsoleConversation, ConsoleLastRun, ConsoleMessage } from '@db3.ai/app/console';
import { agentName, applyEvent, canEdit, costText, definitionFrom, formFor, kindLabel, type AgentForm, type PlaygroundItem } from './agentsView';
import type { ConsoleSource } from './source';

/**
 * An app's agents: the ones made here (files in `db3/agents`) and the ones written in code.
 * Definition edits the files, with the parts set in code shown read-only; Playground sends a
 * message through the app's own runtime; Conversations reads what the agent has said before.
 */
const props = defineProps<{ source: ConsoleSource; readOnly?: string | null }>();

const agents = ref<AgentDescription[] | null>(null);
const tools = ref<ConsoleAgentTool[]>([]);
const selected = ref('');
const tab = ref<'definition' | 'playground' | 'conversations'>('definition');
const loading = ref(false);
const error = ref('');
const form = ref<AgentForm>(formFor(null));
const creating = ref(false);
const newName = ref('');
const saving = ref(false);
const notice = ref('');
const lastRun = ref<ConsoleLastRun | null>(null);
const conversations = ref<ConsoleConversation[] | null>(null);
const openConversation = ref<string | null>(null);
const messages = ref<ConsoleMessage[]>([]);
const transcript = ref<PlaygroundItem[]>([]);
const conversationId = ref<string | null>(null);
const draft = ref('');
const contextValues = ref<Record<string, string>>({});
const running = ref<AbortController | null>(null);

const agent = computed(() => agents.value?.find(item => item.name === selected.value) ?? null);
const editable = (field: Parameters<typeof canEdit>[1]) => !props.readOnly && (creating.value || canEdit(agent.value, field));
const anyEditable = computed(() => creating.value || (!props.readOnly && Boolean(agent.value?.path)));
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
const contextFields = computed(() => (creating.value ? form.value.context : agent.value?.context ?? []).map(field => field.name).filter(Boolean));

/** Reads the agents, keeping the open one open. */
async function load() {
	loading.value = true;
	try {
		const result = await props.source.get<{ agents: AgentDescription[]; tools: ConsoleAgentTool[] }>('agents');
		agents.value = result.agents;
		tools.value = result.tools;
		error.value = '';
		if (!result.agents.some(item => item.name === selected.value)) pick(result.agents[0]?.name ?? '');
		else form.value = formFor(agent.value);
	} catch (cause) {
		error.value = message(cause, "Could not read the app's agents.");
	} finally {
		loading.value = false;
	}
}

function pick(name: string) {
	selected.value = name;
	creating.value = false;
	notice.value = '';
	form.value = formFor(agents.value?.find(item => item.name === name) ?? null);
	resetPlayground();
	conversations.value = null;
	openConversation.value = null;
	lastRun.value = null;
	if (name) void loadDetails(name);
}

/** Loads what code agents last sent, and the recent conversations. */
async function loadDetails(name: string) {
	try {
		const [run, list] = await Promise.all([
			props.source.get<{ lastRun: ConsoleLastRun | null }>(`agents/${encodeURIComponent(name)}/last-run`),
			props.source.get<{ conversations: ConsoleConversation[] }>(`agents/${encodeURIComponent(name)}/conversations`),
		]);
		if (selected.value !== name) return;
		lastRun.value = run.lastRun;
		conversations.value = list.conversations;
	} catch {
		if (selected.value === name) conversations.value = [];
	}
}

function startNew() {
	creating.value = true;
	newName.value = '';
	selected.value = '';
	tab.value = 'definition';
	notice.value = '';
	form.value = { ...formFor(null), instructions: 'You help people with this app. Answer briefly and say when you are not sure.' };
}

async function save() {
	const name = creating.value ? agentName(newName.value) : form.value.name;
	if (!name) { notice.value = 'Give the agent a name, such as support.'; return; }
	saving.value = true;
	notice.value = '';
	try {
		const definition = definitionFrom({ ...form.value, name });
		const saved = await props.source.send<{ revision: string; path: string }>('PUT', `agents/${encodeURIComponent(name)}`, { definition, instructions: form.value.instructions, expectedRevision: creating.value ? null : agent.value?.revision ?? null });
		creating.value = false;
		selected.value = name;
		await load();
		notice.value = `Saved to ${saved.path}. Commit it with your code.`;
	} catch (cause) {
		notice.value = message(cause, 'Could not save the agent.');
	} finally {
		saving.value = false;
	}
}

function toggleTool(name: string) {
	form.value.tools = form.value.tools.includes(name) ? form.value.tools.filter(item => item !== name) : [...form.value.tools, name];
}

function resetPlayground() {
	running.value?.abort();
	running.value = null;
	transcript.value = [];
	conversationId.value = null;
	draft.value = '';
	contextValues.value = {};
}

/** Sends the draft through the agent and shows the reply as it streams. */
async function send() {
	const text = draft.value.trim();
	if (!text || running.value || !agent.value) return;
	draft.value = '';
	transcript.value.push({ kind: 'user', text });
	const controller = new AbortController();
	running.value = controller;
	const context = Object.fromEntries(Object.entries(contextValues.value).filter(([, value]) => value.trim()));
	try {
		await props.source.stream(`agents/${encodeURIComponent(agent.value.name)}/runs`, { message: text, context, conversationId: conversationId.value }, event => {
			const id = applyEvent(transcript.value, event);
			if (id) conversationId.value = id;
		}, controller.signal);
	} catch (cause) {
		if (!controller.signal.aborted) transcript.value.push({ kind: 'error', text: message(cause, 'The run failed.') });
	} finally {
		running.value = null;
		void loadDetails(agent.value.name);
	}
}

async function showConversation(id: string) {
	openConversation.value = id;
	messages.value = [];
	try { messages.value = (await props.source.get<{ messages: ConsoleMessage[] }>(`conversations/${encodeURIComponent(id)}/messages`)).messages; }
	catch (cause) { notice.value = message(cause, 'Could not read the conversation.'); }
}

/** Opens a past conversation in the playground, to carry it on. */
function continueConversation(id: string) {
	resetPlayground();
	conversationId.value = id;
	transcript.value = messages.value.filter(item => item.role === 'user' || item.role === 'assistant').map(item => item.role === 'user' ? { kind: 'user' as const, text: item.content ?? '' } : { kind: 'assistant' as const, text: item.content ?? '', done: true });
	tab.value = 'playground';
}

defineExpose({ reload: load });
watch(() => props.source, () => { agents.value = null; selected.value = ''; void load(); }, { immediate: true });
</script>

<template>
	<section class="flex h-full min-h-0 flex-col bg-canvas text-canvas-fg" data-console-agents>
		<div v-if="error" role="alert" class="m-4 flex flex-wrap items-center gap-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" data-agents-error>
			<span class="whitespace-pre-wrap">{{ error }}</span>
			<button type="button" class="font-medium underline" @click="load">Try again</button>
		</div>
		<p v-else-if="!agents" class="m-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-fg">Reading the app's agents…</p>
		<div v-else class="grid min-h-0 flex-1 lg:grid-cols-[220px_minmax(0,1fr)]">
			<nav class="flex flex-col gap-1 border-b border-border p-2 lg:overflow-y-auto lg:border-b-0 lg:border-r" aria-label="Agents">
				<div class="flex items-center justify-between px-2 pb-1 pt-1">
					<p class="text-[10px] font-semibold uppercase tracking-widest text-muted-fg">Agents</p>
					<button type="button" class="text-xs text-muted-fg hover:text-canvas-fg" :disabled="loading" title="Read the agents again" @click="load">{{ loading ? 'Reading…' : 'Refresh' }}</button>
				</div>
				<button v-for="item in agents" :key="item.name" type="button" class="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left text-sm" :class="item.name === selected && !creating ? 'bg-accent text-accent-fg' : 'hover:bg-muted'" :data-agent="item.name" @click="pick(item.name)">
					<span class="truncate font-medium">{{ item.title || item.name }}</span>
					<span class="text-[11px] text-muted-fg">{{ kindLabel(item.kind) }}<template v-if="item.title"> · {{ item.name }}</template></span>
				</button>
				<p v-if="!agents.length && !creating" class="px-2 py-3 text-sm text-muted-fg">No agents yet.</p>
				<button v-if="!readOnly" type="button" class="mt-1 min-h-8 rounded-lg border border-dashed border-border px-2 text-left text-sm text-muted-fg hover:bg-muted" :class="creating && 'bg-muted text-canvas-fg'" data-agent-new @click="startNew">+ New agent</button>
			</nav>

			<div v-if="agent || creating" class="flex min-h-0 min-w-0 flex-col">
				<header class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
					<h2 class="text-sm font-semibold">{{ creating ? 'New agent' : agent!.title || agent!.name }}</h2>
					<span v-if="agent && !creating" class="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-fg">{{ kindLabel(agent.kind) }}</span>
					<span v-if="agent?.path && !creating" class="font-mono text-xs text-muted-fg">{{ agent.path }}/</span>
					<span v-else-if="agent?.className && !creating" class="font-mono text-xs text-muted-fg">{{ agent.className }} in server/agents</span>
				</header>
				<nav v-if="!creating" class="flex gap-4 border-b border-border px-4" aria-label="Agent">
					<button v-for="[key, label] in ([['definition', 'Definition'], ['playground', 'Playground'], ['conversations', 'Conversations']] as const)" :key="key" type="button" class="-mb-px border-b-2 py-2 text-sm" :class="tab === key ? 'border-primary font-medium' : 'border-transparent text-muted-fg hover:text-canvas-fg'" :data-agent-tab="key" @click="tab = key">{{ label }}<template v-if="key === 'conversations' && conversations?.length"> · {{ conversations.length }}</template></button>
				</nav>

				<form v-if="tab === 'definition' || creating" class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" data-agent-definition @submit.prevent="save">
					<p v-if="readOnly" class="rounded-lg bg-muted p-3 text-sm text-muted-fg">{{ readOnly }}</p>
					<p v-else-if="agent && !agent.path && !creating" class="rounded-lg bg-muted p-3 text-sm text-muted-fg">This agent is written in code, so it's shown here read-only. Change it in {{ agent.className ? `${agent.className} (server/agents)` : 'server/agents' }}.</p>
					<p v-else-if="agent?.overrides.length && !creating" class="rounded-lg bg-muted p-3 text-sm text-muted-fg">Code sets {{ agent.overrides.join(', ') }} for this agent, so those parts are read-only here. The rest saves to its files.</p>

					<label v-if="creating" class="block space-y-1 text-sm"><span class="font-medium">Name</span>
						<input v-model="newName" class="w-full rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-sm" placeholder="support" data-agent-name>
						<span class="block text-xs text-muted-fg">Saved as db3/agents/{{ agentName(newName) || 'name' }}/. Lower case letters, digits and dashes.</span>
					</label>
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="block space-y-1 text-sm"><span class="font-medium">Title</span><input v-model="form.title" :disabled="!editable('title')" class="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm disabled:border-dashed disabled:text-muted-fg" placeholder="Support"></label>
						<label class="block space-y-1 text-sm"><span class="font-medium">Model</span><input v-model="form.model" :disabled="!editable('model')" class="w-full rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-sm disabled:border-dashed disabled:text-muted-fg" placeholder="The app's default model"></label>
						<label class="block space-y-1 text-sm sm:col-span-2"><span class="font-medium">Description</span><input v-model="form.description" :disabled="!editable('description')" class="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm disabled:border-dashed disabled:text-muted-fg" placeholder="What it's for"></label>
						<label class="block space-y-1 text-sm"><span class="font-medium">Max turns</span><input v-model="form.maxTurns" :disabled="!editable('maxTurns')" inputmode="numeric" class="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm disabled:border-dashed disabled:text-muted-fg" placeholder="8"></label>
						<label class="block space-y-1 text-sm"><span class="font-medium">Reasoning effort</span>
							<select v-model="form.reasoningEffort" :disabled="!editable('reasoningEffort')" class="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm disabled:border-dashed disabled:text-muted-fg"><option value="">Model default</option><option v-for="level in ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']" :key="level" :value="level">{{ level }}</option></select>
						</label>
					</div>

					<label class="block space-y-1 text-sm"><span class="font-medium">Instructions</span>
						<textarea v-if="form.instructions !== '' || editable('instructions') || creating" v-model="form.instructions" :disabled="!editable('instructions')" rows="10" class="w-full rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-[13px] leading-relaxed disabled:border-dashed disabled:text-muted-fg" data-agent-instructions />
						<span class="block text-xs text-muted-fg">Use {{ '{' }}{{ '{' }}context.name{{ '}' }}{{ '}' }} for a context value the caller sets.</span>
					</label>
					<div v-if="agent && !agent.instructions && !creating" class="space-y-1 text-sm">
						<p class="font-medium">Instructions as sent on the latest run</p>
						<pre v-if="lastRun?.instructions" class="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-dashed border-border p-3 font-mono text-[12px] text-muted-fg" data-agent-last-run>{{ lastRun.instructions }}</pre>
						<p v-else class="rounded-lg border border-dashed border-border p-3 text-xs text-muted-fg">Code builds these for each run. Send a message in the Playground and they show here.</p>
					</div>

					<div class="space-y-2 text-sm">
						<p class="font-medium">Context <span class="font-normal text-muted-fg">— values your code sets for each run; the model can't change them</span></p>
						<div v-for="(field, index) in form.context" :key="index" class="flex gap-2">
							<input v-model="field.name" :disabled="!editable('context')" class="w-40 rounded-lg border border-border bg-canvas px-3 py-1.5 font-mono text-sm disabled:border-dashed" placeholder="customerId">
							<input v-model="field.description" :disabled="!editable('context')" class="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm disabled:border-dashed" placeholder="What it is">
							<button v-if="editable('context')" type="button" class="rounded-lg px-2 text-muted-fg hover:bg-muted" aria-label="Remove field" @click="form.context.splice(index, 1)">✕</button>
						</div>
						<button v-if="editable('context')" type="button" class="text-xs text-muted-fg underline" @click="form.context.push({ name: '', description: '' })">Add a context field</button>
					</div>

					<div class="space-y-2 text-sm">
						<p class="font-medium">Tools</p>
						<template v-if="editable('tools')">
							<label v-for="item in tools" :key="item.name" class="flex items-start gap-2 rounded-lg border border-border p-2">
								<input type="checkbox" class="mt-1" :checked="form.tools.includes(item.name)" @change="toggleTool(item.name)">
								<span><span class="font-mono text-xs font-medium">{{ item.name }}</span> · {{ item.title }}<span class="block text-xs text-muted-fg">{{ item.description }}</span></span>
							</label>
							<p v-if="!tools.length" class="rounded-lg border border-dashed border-border p-3 text-xs text-muted-fg">No tools yet. Write one with defineTool() in server/tools and list it in server/agents/index.ts.</p>
						</template>
						<template v-else>
							<p v-for="name in (agent?.tools.length ? agent.tools : lastRun?.tools ?? [])" :key="name" class="rounded-lg border border-dashed border-border px-3 py-1.5 font-mono text-xs">{{ name }}</p>
							<p v-if="!agent?.tools.length && !lastRun?.tools.length" class="text-xs text-muted-fg">None listed.</p>
						</template>
					</div>

					<div v-if="anyEditable" class="flex flex-wrap items-center gap-3 border-t border-border pt-4">
						<button type="submit" class="min-h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg disabled:opacity-50" :disabled="saving" data-agent-save>{{ saving ? 'Saving…' : creating ? 'Create agent' : 'Save' }}</button>
						<button v-if="creating" type="button" class="min-h-9 rounded-lg border border-border px-3 text-sm" @click="creating = false; pick(agents![0]?.name ?? '')">Cancel</button>
						<span class="text-sm text-muted-fg" data-agent-notice>{{ notice }}</span>
					</div>
				</form>

				<div v-else-if="tab === 'playground'" class="flex min-h-0 flex-1 flex-col" data-agent-playground>
					<div v-if="contextFields.length" class="flex flex-wrap gap-3 border-b border-border px-4 py-3">
						<label v-for="name in contextFields" :key="name" class="flex items-center gap-2 text-xs"><span class="font-mono text-muted-fg">{{ name }}</span><input v-model="contextValues[name]" class="w-40 rounded-lg border border-border bg-canvas px-2 py-1 text-sm"></label>
					</div>
					<div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
						<p v-if="!transcript.length" class="py-10 text-center text-sm text-muted-fg">Send a message to try {{ agent!.title || agent!.name }}. It runs through your app's own code and is saved as a conversation.</p>
						<template v-for="(item, index) in transcript" :key="index">
							<p v-if="item.kind === 'user'" class="ml-auto max-w-[80%] whitespace-pre-wrap rounded-xl bg-primary/10 px-3 py-2 text-sm" data-playground-user>{{ item.text }}</p>
							<p v-else-if="item.kind === 'assistant'" class="max-w-[85%] whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-sm" data-playground-assistant>{{ item.text }}<span v-if="!item.done" class="animate-pulse">▍</span></p>
							<p v-else-if="item.kind === 'tool'" class="max-w-[85%] rounded-lg border border-border px-3 py-1.5 font-mono text-xs" :class="item.state === 'failed' && 'text-destructive'" data-playground-tool><b>{{ item.name }}</b> · {{ item.state === 'calling' ? 'running…' : item.state }}<span class="block truncate text-muted-fg">{{ item.detail }}</span></p>
							<p v-else class="max-w-[85%] whitespace-pre-wrap rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" data-playground-error>{{ item.text }}</p>
						</template>
					</div>
					<form class="flex gap-2 border-t border-border p-3" @submit.prevent="send">
						<textarea v-model="draft" rows="2" class="min-w-0 flex-1 resize-none rounded-lg border border-border bg-canvas px-3 py-2 text-sm" placeholder="Message" data-playground-input @keydown.enter.exact.prevent="send" />
						<div class="flex flex-col gap-1">
							<button v-if="running" type="button" class="min-h-9 rounded-lg border border-border px-3 text-sm" @click="running?.abort()">Stop</button>
							<button v-else type="submit" class="min-h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg disabled:opacity-50" :disabled="!draft.trim()" data-playground-send>Send</button>
							<button v-if="transcript.length && !running" type="button" class="text-xs text-muted-fg underline" @click="resetPlayground">New conversation</button>
						</div>
					</form>
				</div>

				<div v-else class="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" data-agent-conversations>
					<div class="min-h-0 overflow-y-auto border-b border-border xl:border-b-0 xl:border-r">
						<p v-if="!conversations" class="p-4 text-sm text-muted-fg">Reading conversations…</p>
						<p v-else-if="!conversations.length" class="p-4 text-sm text-muted-fg">No conversations yet.</p>
						<button v-for="item in conversations ?? []" :key="item.id" type="button" class="flex w-full flex-col items-start gap-0.5 border-b border-border px-4 py-2 text-left text-sm" :class="item.id === openConversation ? 'bg-accent text-accent-fg' : 'hover:bg-muted'" @click="showConversation(item.id)">
							<span class="truncate font-medium">{{ item.title || 'Untitled' }}</span>
							<span class="text-[11px] text-muted-fg">{{ new Date(item.updatedAt).toLocaleString() }} · {{ item.messages }} messages · {{ costText(item.costUSD) }}<template v-if="item.user"> · {{ item.user }}</template></span>
						</button>
					</div>
					<div class="min-h-0 space-y-2 overflow-y-auto p-4">
						<p v-if="!openConversation" class="py-10 text-center text-sm text-muted-fg">Pick a conversation to read it.</p>
						<template v-else>
							<button type="button" class="text-xs text-muted-fg underline" @click="continueConversation(openConversation)">Continue in Playground</button>
							<div v-for="item in messages" :key="item.id" class="rounded-lg px-3 py-2 text-sm" :class="item.role === 'user' ? 'ml-8 bg-primary/10' : item.role === 'assistant' ? 'mr-8 bg-muted' : 'border border-dashed border-border font-mono text-xs'">
								<span class="block text-[10px] uppercase tracking-wider text-muted-fg">{{ item.toolName ? `${item.role} · ${item.toolName}` : item.role }}</span>
								<span class="whitespace-pre-wrap">{{ item.content }}</span>
							</div>
						</template>
					</div>
				</div>
			</div>
			<p v-else class="m-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-fg">Pick an agent, or make a new one. Agents made here are saved as files in db3/agents.</p>
		</div>
	</section>
</template>
