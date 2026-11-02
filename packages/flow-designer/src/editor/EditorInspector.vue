<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FlowBlockMetadata, FlowGraphDefinition, FlowValueType } from '@db3.ai/app/flows';
import type { FlowStepRunRecord } from '../contracts';
import { ERROR_EXIT, START, TRIGGER_TYPES, edgeSource, settingFields, settingText, settingValue, stepExits, type FlowProblem } from './graph';

/**
 * Settings for what is selected: a step, a line, or (for Start or nothing) the flow
 * itself with its inputs, outputs and triggers. Changes are made on the flow in place;
 * the parent marks it changed.
 */
const props = defineProps<{
	flow: FlowGraphDefinition;
	blocks: Map<string, FlowBlockMetadata>;
	selected: string | null;
	problems: FlowProblem[];
	editable: boolean;
	/** The shown run's record of the selected step. */
	stepRun?: FlowStepRunRecord | null;
}>();

const emit = defineEmits<{
	changed: [];
	rename: [from: string, to: string];
	remove: [key: string];
	detail: [name: string];
}>();

/** Writes `{{path}}` without the template reading it as an interpolation. */
const mustache = (path: string): string => `${'{'}{${path}}${'}'}`;

const VALUE_TYPES: FlowValueType[] = ['string', 'number', 'boolean', 'object', 'array', 'json'];

const step = computed(() => props.selected && props.selected !== START && !props.selected.startsWith('edge:') ? props.flow.steps[props.selected] ?? null : null);
const block = computed(() => step.value ? props.blocks.get(step.value.type) : undefined);
const fields = computed(() => settingFields(block.value));
const exits = computed(() => step.value ? stepExits(step.value, block.value) : []);
const edge = computed(() => props.selected?.startsWith('edge:') ? props.flow.edges[Number(props.selected.slice(5))] ?? null : null);
const stepProblems = computed(() => props.problems.filter(problem => problem.step === (step.value ? props.selected : 'flow')).map(problem => problem.message));
const triggerTypes = computed(() => [...new Set([...TRIGGER_TYPES, ...[...props.blocks.values()].filter(item => item.kind === 'trigger').map(item => item.type)])]);

const nameDraft = ref('');
const renameError = ref<string | null>(null);
watch(() => props.selected, value => { nameDraft.value = value ?? ''; renameError.value = null; }, { immediate: true });

function commitName(): void {
	if (!props.selected || nameDraft.value === props.selected) return;
	emit('rename', props.selected, nameDraft.value.trim());
}

function setSetting(key: string, text: string): void {
	if (!step.value) return;
	const value = settingValue(text, fields.value[key]?.type);
	const config = { ...(step.value.config ?? {}) };
	if (value === undefined) delete config[key];
	else config[key] = value;
	step.value.config = config;
	emit('changed');
}

function setTitle(text: string): void {
	if (!step.value) return;
	if (text.trim()) step.value.title = text;
	else delete step.value.title;
	emit('changed');
}

const newInput = ref('');
function addInput(): void {
	const name = newInput.value.trim();
	if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || props.flow.inputs[name]) return;
	props.flow.inputs = { ...props.flow.inputs, [name]: { type: 'string', required: true } };
	newInput.value = '';
	emit('changed');
}

function removeInput(name: string): void {
	const { [name]: _removed, ...rest } = props.flow.inputs;
	props.flow.inputs = rest;
	emit('changed');
}

const newOutput = ref('');
function addOutput(): void {
	const name = newOutput.value.trim();
	if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || props.flow.outputs?.[name]) return;
	props.flow.outputs = { ...(props.flow.outputs ?? {}), [name]: { type: 'json', value: '' } };
	newOutput.value = '';
	emit('changed');
}

function removeOutput(name: string): void {
	const { [name]: _removed, ...rest } = props.flow.outputs ?? {};
	props.flow.outputs = rest;
	emit('changed');
}

const newTrigger = ref('trigger.webhook');
function addTrigger(): void {
	const base = newTrigger.value.replace(/^trigger\./, '');
	let name = base;
	for (let n = 2; props.flow.triggers?.[name]; n++) name = `${base}-${n}`;
	props.flow.triggers = { ...(props.flow.triggers ?? {}), [name]: { type: newTrigger.value } };
	emit('changed');
}

function removeTrigger(name: string): void {
	const { [name]: _removed, ...rest } = props.flow.triggers ?? {};
	props.flow.triggers = rest;
	emit('changed');
}

const triggerErrors = ref<Record<string, string>>({});
function setTriggerConfig(name: string, text: string): void {
	const trigger = props.flow.triggers?.[name];
	if (!trigger) return;
	try {
		const config = text.trim() ? JSON.parse(text) : undefined;
		if (config === undefined) delete trigger.config;
		else trigger.config = config;
		triggerErrors.value = { ...triggerErrors.value, [name]: '' };
		emit('changed');
	} catch {
		triggerErrors.value = { ...triggerErrors.value, [name]: 'Not valid JSON yet.' };
	}
}

function edgeLabel(source: string): string {
	const { step: name, exit } = edgeSource(source);
	const title = name === START ? 'Start' : props.flow.steps[name]?.title || name;
	return exit ? `${title} (${exit})` : title;
}

function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function rows(text: string): number {
	return Math.min(8, Math.max(1, text.split('\n').length, Math.ceil(text.length / 40)));
}
</script>

<template>
	<!-- A line between two boxes -->
	<div v-if="edge" class="fe-insp">
		<div><span class="type">connection</span><h2>{{ edgeLabel(edge[0]) }} → {{ edgeLabel(edge[1]) }}</h2></div>
		<p class="note">
			{{ edgeSource(edge[0]).exit === 'error' ? 'Runs when the step still fails after its last retry.' : edgeSource(edge[0]).exit ? `Runs when ${edgeLabel(edgeSource(edge[0]).step)} takes its ${edgeSource(edge[0]).exit} exit.` : 'Runs after the step finishes.' }}
			Values are not carried by lines: a later step reads them with references such as <span class="ref" v-text="mustache(edgeSource(edge[0]).step === 'input' ? 'input.email' : `${edgeSource(edge[0]).step}.field`)" />.
		</p>
		<button v-if="editable" class="btn danger" @click="emit('remove', selected!)">Remove connection</button>
	</div>

	<!-- A step -->
	<div v-else-if="step && selected" class="fe-insp">
		<div>
			<span class="type">{{ step.type }}</span>
			<h2>{{ step.title || block?.name || selected }}</h2>
			<p v-if="block?.description" class="note">{{ block.description }}</p>
		</div>
		<ul v-if="stepProblems.length" class="problems"><li v-for="problem in stepProblems" :key="problem">{{ problem }}</li></ul>
		<button class="btn primary" @click="emit('detail', selected)">Open step details</button>

		<div v-if="stepRun" class="field">
			<span class="label">This run</span>
			<div class="rows">
				<div>Status<em><span class="pill" :class="{ ok: stepRun.status === 'completed', bad: stepRun.status === 'failed', acc: ['running', 'queued'].includes(stepRun.status) }">{{ stepRun.exit ? `${stepRun.status} · ${stepRun.exit}` : stepRun.status }}</span></em></div>
				<div>Tries<em>{{ stepRun.attempt }}</em></div>
			</div>
			<span class="label">Input</span><pre class="code">{{ json(stepRun.input) }}</pre>
			<span class="label">{{ stepRun.error ? 'Error' : 'Output' }}</span><pre class="code">{{ json(stepRun.error ?? stepRun.output) }}</pre>
		</div>

		<template v-else>
			<div class="field">
				<label for="fe-step-name">Name <small>used in references</small></label>
				<input id="fe-step-name" v-model="nameDraft" class="mono" :disabled="!editable" @change="commitName" @keydown.enter="commitName">
			</div>
			<div class="field">
				<label for="fe-step-title">Title</label>
				<input id="fe-step-title" :value="step.title ?? ''" :placeholder="block?.name" :disabled="!editable" @input="setTitle(($event.target as HTMLInputElement).value)">
			</div>
			<div v-for="(field, key) in fields" :key="key" class="field">
				<label :for="`fe-set-${key}`">{{ field.editor?.label ?? key }} <span v-if="field.required && field.default === undefined" class="req">*</span><small>{{ field.type }}</small></label>
				<textarea
					:id="`fe-set-${key}`"
					:rows="rows(settingText(step.config?.[key]))"
					:placeholder="field.editor?.placeholder ?? (field.default !== undefined ? settingText(field.default) : '{{input.field}} or a value')"
					:value="settingText(step.config?.[key])"
					:disabled="!editable"
					spellcheck="false"
					@input="setSetting(String(key), ($event.target as HTMLTextAreaElement).value)"
				/>
				<small v-if="field.description">{{ field.description }}</small>
			</div>
			<p v-if="!Object.keys(fields).length" class="note">This block has no settings.</p>
			<div class="field">
				<span class="label">Exits</span>
				<p class="note">{{ exits.length ? `${exits.join(', ')}, and ${ERROR_EXIT} when it fails.` : `One way out, and ${ERROR_EXIT} when it fails. Select the box to connect its error exit.` }}</p>
			</div>
			<button v-if="editable" class="btn danger" @click="emit('remove', selected)">Remove step</button>
		</template>
	</div>

	<!-- The flow itself -->
	<div v-else class="fe-insp">
		<div><span class="type">db3/flows/{{ flow.name }}.flow.json</span><h2>{{ flow.title || flow.name }}</h2></div>
		<ul v-if="stepProblems.length" class="problems"><li v-for="problem in stepProblems" :key="problem">{{ problem }}</li></ul>
		<div class="field">
			<label for="fe-flow-title">Title</label>
			<input id="fe-flow-title" v-model="flow.title" :disabled="!editable" @input="emit('changed')">
		</div>
		<div class="field">
			<label for="fe-flow-description">Description</label>
			<textarea id="fe-flow-description" v-model="flow.description" rows="2" :disabled="!editable" @input="emit('changed')" />
		</div>

		<div class="field">
			<span class="label">Inputs <small v-text="`read as ${mustache('input.name')}`" /></span>
			<div v-for="(input, name) in flow.inputs" :key="name" class="grid2">
				<span class="mono">{{ name }}</span>
				<select v-model="input.type" :aria-label="`${name} type`" :disabled="!editable" @change="emit('changed')">
					<option v-for="type in VALUE_TYPES" :key="type" :value="type">{{ type }}</option>
				</select>
				<label><input v-model="input.required" type="checkbox" :disabled="!editable" @change="emit('changed')"> required</label>
				<button v-if="editable" class="btn small" :aria-label="`Remove ${name}`" @click="removeInput(String(name))">×</button>
			</div>
			<form v-if="editable" class="grid2" @submit.prevent="addInput">
				<input v-model="newInput" class="mono" placeholder="email" aria-label="New input name">
				<button class="btn small" type="submit">Add input</button>
			</form>
		</div>

		<div class="field">
			<span class="label">Outputs <small>what a run returns</small></span>
			<div v-for="(output, name) in flow.outputs ?? {}" :key="name" class="grid2">
				<span class="mono">{{ name }}</span>
				<input v-model="output.value" class="mono" placeholder="{{step.field}}" :aria-label="`${name} value`" :disabled="!editable" style="grid-column: span 2" @input="emit('changed')">
				<button v-if="editable" class="btn small" :aria-label="`Remove ${name}`" @click="removeOutput(String(name))">×</button>
			</div>
			<form v-if="editable" class="grid2" @submit.prevent="addOutput">
				<input v-model="newOutput" class="mono" placeholder="kind" aria-label="New output name">
				<button class="btn small" type="submit">Add output</button>
			</form>
		</div>

		<div class="field">
			<span class="label">Triggers <small>ways in besides flows.start()</small></span>
			<div v-for="(trigger, name) in flow.triggers ?? {}" :key="name" class="field">
				<div class="grid2">
					<span class="mono">{{ name }}</span>
					<span class="type" style="grid-column: span 2">{{ trigger.type }}</span>
					<button v-if="editable" class="btn small" :aria-label="`Remove ${name}`" @click="removeTrigger(String(name))">×</button>
				</div>
				<textarea rows="2" spellcheck="false" placeholder='{ "title": "Contact us" }' :value="trigger.config ? JSON.stringify(trigger.config) : ''" :disabled="!editable" :aria-label="`${name} settings`" @input="setTriggerConfig(String(name), ($event.target as HTMLTextAreaElement).value)" />
				<small v-if="triggerErrors[name]">{{ triggerErrors[name] }}</small>
			</div>
			<div v-if="editable" class="grid2">
				<select v-model="newTrigger" aria-label="Trigger type" style="grid-column: span 2">
					<option v-for="type in triggerTypes" :key="type" :value="type">{{ type }}</option>
				</select>
				<button class="btn small" style="grid-column: span 2" @click="addTrigger">Add trigger</button>
			</div>
		</div>
	</div>
</template>
