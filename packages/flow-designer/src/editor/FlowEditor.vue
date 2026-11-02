<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { FlowBlockMetadata, FlowDefinitionSummary, FlowGraphDefinition, FlowValues } from '@db3.ai/app/flows';
import { ulid } from '@db3.ai/pure/ulid';
import type { FlowEditorClient, FlowRunDetailsRecord } from '../contracts';
import EditorCanvas from './EditorCanvas.vue';
import EditorInspector from './EditorInspector.vue';
import RunsPanel from './RunsPanel.vue';
import StepDetail from './StepDetail.vue';
import { START, addEdge, addStep, blankFlow, blockKind, checkFlow, flowFileText, libraryGroups, placeUnplaced, removeStep, renameStep, settingValue, TRIGGER_TYPES, triggerDefaults, type FlowProblem } from './graph';

/**
 * The flow editor for `db3/flows/<name>.flow.json` (file shape 2): block library,
 * canvas and settings, a Runs view that paints a run onto the canvas, and the file.
 * The host supplies a {@link FlowEditorClient}; without its run methods the Runs
 * view and Test run are hidden.
 */
const props = withDefaults(defineProps<{
	client: FlowEditorClient;
	/** Flow to open first, by id or name. */
	initialFlow?: string;
	/** Read-only, such as for Production. */
	readonly?: boolean;
}>(), { initialFlow: undefined, readonly: false });

const emit = defineEmits<{ saved: [flow: FlowGraphDefinition] }>();

type View = 'edit' | 'runs' | 'file';

const flows = ref<FlowDefinitionSummary[]>([]);
const blocks = ref<FlowBlockMetadata[]>([]);
const blockMap = computed(() => new Map(blocks.value.map(block => [block.type, block])));
const flow = ref<FlowGraphDefinition | null>(null);
const revision = ref<string | undefined>();
const path = ref<string | null>(null);
const dirty = ref(false);
const view = ref<View>('edit');
const selected = ref<string | null>(null);
const detailFor = ref<string | null>(null);
const search = ref('');
const problems = ref<FlowProblem[]>([]);
const toast = ref<{ text: string; items?: string[]; bad?: boolean } | null>(null);
const busy = ref(false);
const loadError = ref<string | null>(null);
const run = shallowRef<FlowRunDetailsRecord | null>(null);
const runRefresh = ref(0);
const testInput = ref<Record<string, string>>({});
const canRun = computed(() => Boolean(props.client.runs && props.client.run && props.client.runDetails));
const editable = computed(() => !props.readonly && view.value === 'edit');

const library = computed(() => libraryGroups(blocks.value, search.value));
const problemCounts = computed(() => problems.value.reduce<Record<string, number>>((counts, problem) => ({ ...counts, [problem.step === 'flow' ? START : problem.step]: (counts[problem.step === 'flow' ? START : problem.step] ?? 0) + 1 }), {}));
const runSteps = computed(() => view.value === 'runs' && run.value ? Object.fromEntries(run.value.steps.map(step => [step.blockId, step])) : null);
const selectedStepRun = computed(() => selected.value ? runSteps.value?.[selected.value] ?? null : null);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string, options: { items?: string[]; bad?: boolean } = {}): void {
	toast.value = { text, ...options };
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { toast.value = null; }, options.bad ? 8000 : 3000);
}

function message(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
}

async function loadCatalog(): Promise<void> {
	const catalog = await props.client.catalog();
	flows.value = catalog.flows;
	blocks.value = catalog.blocks;
}

async function openFlow(idOrName: string): Promise<void> {
	if (dirty.value && !confirm('Leave without saving your changes?')) return;
	busy.value = true;
	loadError.value = null;
	try {
		const stored = await props.client.definition(idOrName);
		if (stored.definition.schemaVersion !== 2) {
			loadError.value = `${stored.definition.name} uses the old block-and-port shape. Recreate it as a new flow to edit it here.`;
			flow.value = null;
			return;
		}
		const opened = structuredClone(stored.definition);
		placeUnplaced(opened);
		flow.value = opened;
		revision.value = stored.revision;
		path.value = stored.path ?? null;
		dirty.value = false;
		selected.value = null;
		run.value = null;
		problems.value = [];
		testInput.value = Object.fromEntries(Object.keys(opened.inputs).map(key => [key, '']));
	} catch (caught) {
		loadError.value = message(caught);
	} finally {
		busy.value = false;
	}
}

function newFlow(): void {
	if (dirty.value && !confirm('Leave without saving your changes?')) return;
	const title = prompt('Name the new flow', 'Lead intake')?.trim();
	if (!title) return;
	flow.value = blankFlow(ulid(), title);
	revision.value = undefined;
	path.value = null;
	dirty.value = true;
	selected.value = START;
	view.value = 'edit';
	loadError.value = null;
}

function changed(): void {
	dirty.value = true;
	if (problems.value.length && flow.value) problems.value = checkFlow(flow.value, blocks.value);
}

function check(announce = true): boolean {
	if (!flow.value) return false;
	problems.value = checkFlow(flow.value, blocks.value);
	if (problems.value.length) {
		say(`${problems.value.length} problem${problems.value.length > 1 ? 's' : ''} to fix before saving.`, { bad: true, items: problems.value.map(problem => `${problem.step === 'flow' ? 'Flow' : problem.step}: ${problem.message}`) });
		return false;
	}
	if (announce) say(`Checked ${Object.keys(flow.value.steps).length} steps: all good.`);
	return true;
}

async function save(): Promise<void> {
	if (!flow.value || !check(false)) return;
	busy.value = true;
	try {
		const stored = await props.client.save(flow.value, revision.value);
		revision.value = stored.revision;
		path.value = stored.path ?? path.value;
		dirty.value = false;
		say('Saved.');
		emit('saved', flow.value);
		await loadCatalog();
	} catch (caught) {
		const lines = message(caught).split('\n').filter(Boolean);
		say(lines.length > 1 ? 'The flow was not saved:' : `Not saved: ${lines[0] ?? 'unknown error'}`, { bad: true, items: lines.length > 1 ? lines : undefined });
	} finally {
		busy.value = false;
	}
}

function addBlock(type: string, at?: [number, number]): void {
	if (!flow.value || !editable.value) return;
	const block = blockMap.value.get(type);
	if (TRIGGER_TYPES.includes(type) || (block && blockKind(block) === 'trigger')) {
		let name = type.replace(/^trigger\./, '');
		for (let n = 2; flow.value.triggers?.[name]; n++) name = `${type.replace(/^trigger\./, '')}-${n}`;
		const config = triggerDefaults(type, flow.value.name);
		flow.value.triggers = { ...(flow.value.triggers ?? {}), [name]: { type, ...(config ? { config } : {}) } };
		selected.value = START;
		changed();
		return;
	}
	if (!block) return;
	const positions = Object.values(flow.value.layout ?? {});
	const fallback: [number, number] = [Math.max(...positions.map(([x]) => x), 40) + 290, 160];
	const name = addStep(flow.value, block, at ?? fallback);
	if (!at && selected.value && (selected.value === START || flow.value.steps[selected.value]) && !flow.value.edges.some(([from]) => from.split('.')[0] === selected.value)) {
		const source = selected.value === START ? START : selected.value;
		const exits = source === START ? [] : (block.exits ?? []);
		if (!exits.length) addEdge(flow.value, source, name);
	}
	selected.value = name;
	changed();
}

function move(name: string, at: [number, number]): void {
	if (!flow.value) return;
	flow.value.layout = { ...(flow.value.layout ?? {}), [name]: at };
	dirty.value = true;
}

function connect(from: string, to: string): void {
	if (!flow.value || !editable.value) return;
	if (addEdge(flow.value, from, to)) changed();
	else say('That connection is already there, or it would make a loop.');
}

function remove(key: string): void {
	if (!flow.value || !editable.value) return;
	if (key.startsWith('edge:')) flow.value.edges.splice(Number(key.slice(5)), 1);
	else if (key !== START) removeStep(flow.value, key);
	else return;
	selected.value = null;
	changed();
}

function rename(from: string, to: string): void {
	if (!flow.value) return;
	const error = renameStep(flow.value, from, to);
	if (error) {
		say(error, { bad: true });
		return;
	}
	selected.value = to;
	changed();
}

function onKey(event: KeyboardEvent): void {
	const target = event.target as HTMLElement | null;
	if (target?.closest('input, textarea, select, [contenteditable]')) return;
	if ((event.key === 'Delete' || event.key === 'Backspace') && selected.value && editable.value && !detailFor.value) {
		event.preventDefault();
		remove(selected.value);
	}
	if (event.key === 'Escape') detailFor.value = null;
	if ((event.metaKey || event.ctrlKey) && event.key === 's') {
		event.preventDefault();
		void save();
	}
}

let poll: ReturnType<typeof setTimeout> | undefined;
async function showRun(runId: string): Promise<void> {
	if (!props.client.runDetails) return;
	clearTimeout(poll);
	try {
		run.value = await props.client.runDetails(runId);
		if (run.value.run.status === 'queued' || run.value.run.status === 'running') poll = setTimeout(() => void showRun(runId), 1500);
		else runRefresh.value++;
	} catch (caught) {
		say(message(caught), { bad: true });
	}
}

async function testRun(): Promise<void> {
	if (!flow.value || !props.client.run) return;
	if (dirty.value) {
		say('Save the flow first, so the run uses what you see.', { bad: true });
		return;
	}
	const input: FlowValues = {};
	for (const [key, field] of Object.entries(flow.value.inputs)) {
		const value = settingValue(testInput.value[key] ?? '', field.type);
		if (value !== undefined) input[key] = value;
	}
	try {
		const started = await props.client.run(flow.value.id, input);
		view.value = 'runs';
		runRefresh.value++;
		await showRun(started.id);
	} catch (caught) {
		say(message(caught), { bad: true });
	}
}

async function replay(): Promise<void> {
	if (!run.value || !props.client.replay) return;
	try {
		const again = await props.client.replay(run.value.run.id, 'original');
		runRefresh.value++;
		await showRun(again.id);
	} catch (caught) {
		say(message(caught), { bad: true });
	}
}

function openBox(name: string): void {
	if (name === START) selected.value = START;
	else detailFor.value = name;
}

function startTest(): void {
	view.value = 'runs';
	selected.value = START;
}

function dragBlock(event: DragEvent, type: string): void {
	event.dataTransfer?.setData('application/x-db3-block', type);
	if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}

watch(view, value => { if (value !== 'runs') clearTimeout(poll); });

onMounted(async () => {
	window.addEventListener('keydown', onKey);
	try {
		await loadCatalog();
		const first = props.initialFlow ?? flows.value.find(item => item.schemaVersion === 2)?.id;
		if (first) await openFlow(first);
	} catch (caught) {
		loadError.value = message(caught);
	}
});

onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKey);
	clearTimeout(poll);
	clearTimeout(toastTimer);
});
</script>

<template>
	<div class="fe" data-flow-editor>
		<div class="fe-top">
			<div class="title">
				<h1>{{ flow?.title || flow?.name || 'Flows' }}</h1>
				<span class="mono faint">{{ path ?? (flow ? `db3/flows/${flow.name}.flow.json` : 'db3/flows') }}</span>
			</div>
			<select :value="flow?.id ?? ''" aria-label="Open a flow" @change="openFlow(($event.target as HTMLSelectElement).value)">
				<option value="" disabled>Open a flow…</option>
				<option v-for="item in flows" :key="item.id" :value="item.id">{{ item.title || item.name }}{{ item.schemaVersion === 2 ? '' : ' (old shape)' }}</option>
			</select>
			<button v-if="!readonly" class="btn" @click="newFlow">New flow</button>
			<span v-if="dirty" class="dirty">Not saved</span>
			<div v-if="flow" class="fe-tabs" role="group" aria-label="View">
				<button :aria-pressed="view === 'edit'" @click="view = 'edit'">Editor</button>
				<button v-if="canRun" :aria-pressed="view === 'runs'" @click="view = 'runs'">Runs</button>
				<button :aria-pressed="view === 'file'" @click="view = 'file'">File</button>
			</div>
			<button v-if="flow && canRun" class="btn" @click="startTest">Test run</button>
			<button v-if="flow && !readonly" class="btn primary" :disabled="busy" @click="save">Save</button>
		</div>

		<div v-if="!flow" class="fe-pane fe-insp">
			<p v-if="loadError" class="problems" style="list-style: none; padding-left: 10px">{{ loadError }}</p>
			<p class="note">{{ busy ? 'Loading…' : flows.length ? 'Pick a flow above, or start a new one.' : 'No flows yet. A flow is a file in db3/flows; start one with New flow.' }}</p>
		</div>

		<div v-else-if="view === 'file'" class="fe-work wide">
			<div class="fe-pane fe-file">
				<div class="bar"><span class="mono">{{ path ?? `db3/flows/${flow.name}.flow.json` }}</span><span>This is the file that is saved. Moving a box changes only <span class="mono">layout</span>.</span></div>
				<pre>{{ flowFileText(flow) }}</pre>
			</div>
		</div>

		<div v-else class="fe-work">
			<aside class="fe-pane fe-lib" aria-label="Blocks">
				<template v-if="editable">
					<input v-model="search" placeholder="Add a block" aria-label="Search blocks">
					<template v-for="group in library" :key="group.title">
						<h3>{{ group.title }}</h3>
						<button v-for="block in group.blocks" :key="block.type" class="item" draggable="true" :title="block.description ?? block.type" @click="addBlock(block.type)" @dragstart="dragBlock($event, block.type)">
							<span class="fe-tile" :class="`k-${group.kind}`">{{ block.name.slice(0, 1).toUpperCase() }}</span>
							<span>{{ block.name }}<small>{{ block.type }}</small></span>
						</button>
					</template>
					<p v-if="!library.length" class="note" style="margin-top: 10px">No blocks match.</p>
				</template>
				<template v-else>
					<p class="note">{{ readonly ? 'Read only here.' : 'Showing a run. Switch to Editor to change the flow.' }}</p>
				</template>
			</aside>

			<div class="fe-pane fe-canvas-wrap">
				<span class="fe-hint">
					<span>{{ view === 'runs' ? (run ? `Run ${run.run.id.slice(0, 10)}… · ${run.run.status}. Faded boxes were skipped.` : 'Pick a run to see the path it took.') : 'Drag boxes to move them. Drag from a dot to another box to connect. Double-click for details.' }}</span>
					<button v-if="view === 'edit'" @click="check()">Check flow</button>
				</span>
				<EditorCanvas
					:flow="flow"
					:blocks="blockMap"
					:selected="selected"
					:problems="problemCounts"
					:steps="runSteps"
					:editable="editable"
					@select="selected = $event"
					@move="move"
					@connect="connect"
					@open="openBox"
					@drop="(type, at) => addBlock(type, at)"
				/>
				<p v-if="!Object.keys(flow.steps).length" class="fe-empty-canvas note">Add a block from the left. It is connected after the selected box, starting from Start.</p>
			</div>

			<aside class="fe-pane" aria-live="polite">
				<div v-if="view === 'runs'" class="fe-insp">
					<div v-if="canRun" class="field">
						<span class="label">Test run</span>
						<div v-for="(field, key) in flow.inputs" :key="key" class="field">
							<label :for="`fe-test-${key}`">{{ key }} <span v-if="field.required" class="req">*</span><small>{{ field.type }}</small></label>
							<input :id="`fe-test-${key}`" v-model="testInput[key]">
						</div>
						<button class="btn primary" @click="testRun">Start run</button>
					</div>
					<RunsPanel :client="client" :flow-id="flow.id" :selected-run-id="run?.run.id ?? null" :refresh="runRefresh" @select="showRun" />
					<template v-if="run">
						<div class="rows">
							<div>Status<em><span class="pill" :class="{ ok: run.run.status === 'completed', bad: run.run.status === 'failed' }">{{ run.run.status }}</span></em></div>
							<div>Started<em>{{ run.run.startedAt ? new Date(run.run.startedAt).toLocaleString() : '—' }}</em></div>
						</div>
						<div class="field"><span class="label">{{ run.run.error ? 'Error' : 'Output' }}</span><pre class="code">{{ JSON.stringify(run.run.error ?? run.run.output, null, 2) }}</pre></div>
						<button v-if="client.replay" class="btn" @click="replay">Run again with the same input</button>
					</template>
					<EditorInspector v-if="selected && selected !== START && flow.steps[selected]" :flow="flow" :blocks="blockMap" :selected="selected" :problems="problems" :editable="false" :step-run="selectedStepRun" @detail="detailFor = $event" style="padding: 0" />
				</div>
				<EditorInspector
					v-else
					:flow="flow"
					:blocks="blockMap"
					:selected="selected === START ? null : selected"
					:problems="problems"
					:editable="editable"
					@changed="changed"
					@rename="rename"
					@remove="remove"
					@detail="detailFor = $event"
				/>
			</aside>
		</div>

		<StepDetail v-if="flow && detailFor && flow.steps[detailFor]" :flow="flow" :name="detailFor" :blocks="blockMap" :run="view === 'runs' ? run : null" :editable="editable" @close="detailFor = null" @changed="changed" />

		<div v-if="toast" class="fe-toast" :class="{ bad: toast.bad }" role="status">
			<b>{{ toast.text }}</b>
			<ul v-if="toast.items"><li v-for="item in toast.items" :key="item">{{ item }}</li></ul>
		</div>
	</div>
</template>
