<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { FlowBlockMetadata, FlowGraphDefinition, FlowValue, FlowValues } from '@db3.ai/app/flows';
import type { FlowRunDetailsRecord } from '../contracts';
import { START, blockKind, settingFields, settingText, settingValue, stepsBefore } from './graph';

/**
 * One step up close: what earlier steps hand it (left; click a field to insert its
 * reference), its settings (middle), and what it returned in the shown run (right).
 */
const props = defineProps<{
	flow: FlowGraphDefinition;
	name: string;
	blocks: Map<string, FlowBlockMetadata>;
	run?: FlowRunDetailsRecord | null;
	editable: boolean;
}>();

const emit = defineEmits<{ close: []; changed: [] }>();

const step = computed(() => props.flow.steps[props.name]);
const block = computed(() => props.blocks.get(step.value.type));
const fields = computed(() => settingFields(block.value));
const byStep = computed(() => new Map((props.run?.steps ?? []).map(record => [record.blockId, record])));
const record = computed(() => byStep.value.get(props.name) ?? null);

/** Groups shown on the left: run input, then each earlier step's output (from the run, or its declared outputs). */
const sources = computed(() => {
	const inputValues: FlowValues = props.run?.run.input ?? Object.fromEntries(Object.entries(props.flow.inputs).map(([key, field]) => [key, `‹${field.type}›`]));
	const groups: { root: string; label: string; values: FlowValue }[] = [{ root: START, label: 'input · flow input', values: inputValues }];
	for (const name of stepsBefore(props.flow, props.name)) {
		const earlier = props.flow.steps[name];
		const recorded = byStep.value.get(name);
		const declared = props.blocks.get(earlier.type)?.outputs ?? {};
		const values = recorded?.output ?? Object.fromEntries(Object.entries(declared).map(([key, field]) => [key, `‹${field.type}›`]));
		groups.push({ root: name, label: `${name} · ${earlier.title || props.blocks.get(earlier.type)?.name || earlier.type}${recorded?.status === 'skipped' ? ' (skipped)' : ''}`, values });
	}
	return groups;
});

/** Flattens a value into rows of `path` and a short preview. */
function rows(prefix: string, value: FlowValue, depth = 0): { path: string; key: string; preview: string; depth: number }[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
	return Object.entries(value).flatMap(([key, item]) => {
		const path = `${prefix}.${key}`;
		const nested = item && typeof item === 'object' && !Array.isArray(item);
		return [{ path, key, preview: nested ? '{ … }' : JSON.stringify(item) ?? '', depth }, ...(nested && depth < 3 ? rows(path, item, depth + 1) : [])];
	});
}

/** Writes `{{path}}` without the template reading it as an interpolation. */
const mustache = (path: string): string => `${'{'}{${path}}${'}'}`;

const lastField = ref<HTMLTextAreaElement | null>(null);
const panel = ref<HTMLElement | null>(null);

function insert(path: string): void {
	const field = lastField.value;
	if (!field || !props.editable) return;
	const token = `{{${path}}}`;
	const start = field.selectionStart ?? field.value.length;
	const end = field.selectionEnd ?? start;
	field.value = field.value.slice(0, start) + token + field.value.slice(end);
	field.dispatchEvent(new Event('input'));
	nextTick(() => {
		field.focus();
		field.setSelectionRange(start + token.length, start + token.length);
	});
}

function setSetting(key: string, text: string): void {
	const value = settingValue(text, fields.value[key]?.type);
	const config = { ...(step.value.config ?? {}) };
	if (value === undefined) delete config[key];
	else config[key] = value;
	step.value.config = config;
	emit('changed');
}

/** What a setting becomes with the shown run's values. */
function preview(text: string): string {
	return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path: string) => {
		const [root, ...rest] = path.split('.');
		if (root === 'env') return `‹setting ${rest.join('.')}›`;
		let value: FlowValue | undefined = sources.value.find(group => group.root === root)?.values;
		for (const part of rest) value = value && typeof value === 'object' && !Array.isArray(value) ? value[part] : undefined;
		return value === undefined ? `‹missing ${path}›` : typeof value === 'object' ? JSON.stringify(value) : String(value);
	});
}

function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

onMounted(() => {
	lastField.value = panel.value?.querySelector('textarea') ?? null;
	panel.value?.querySelector<HTMLButtonElement>('[data-close]')?.focus();
});
</script>

<template>
	<div class="fe-detail" role="dialog" aria-modal="true" :aria-label="`${name} details`" @click.self="emit('close')" @keydown.esc="emit('close')">
		<div ref="panel" class="card">
			<div class="head">
				<span class="fe-tile" :class="`k-${block ? blockKind(block) : 'app'}`">{{ (step.title || block?.name || name).slice(0, 1).toUpperCase() }}</span>
				<div><span class="type">{{ name }} · {{ step.type }}</span><h2>{{ step.title || block?.name || name }}</h2></div>
				<span class="note" style="margin-left: auto">{{ run ? `Values from run ${run.run.id.slice(0, 10)}…` : 'No run shown: values are the declared types.' }} Click a field on the left to insert it.</span>
				<button class="btn" data-close @click="emit('close')">Close</button>
			</div>
			<div class="cols">
				<section>
					<h3>Input · from earlier steps</h3>
					<div class="fe-tree">
						<template v-for="group in sources" :key="group.root">
							<div class="grp">{{ group.label }}</div>
							<button v-for="row in rows(group.root, group.values)" :key="row.path" :style="{ paddingLeft: `${4 + row.depth * 14}px` }" :title="`Insert {{${row.path}}}`" @click="insert(row.path)">
								<span class="k">{{ row.key }}</span><span class="v">{{ row.preview }}</span>
							</button>
						</template>
						<div class="grp" v-text="`env · settings, as ${mustache('env.NAME')}`" />
					</div>
					<p class="note">Only steps that run before this one are listed, so every reference here exists when it runs.</p>
				</section>
				<section class="mid">
					<h3>Settings</h3>
					<div v-for="(field, key) in fields" :key="key" class="field">
						<label :for="`fe-detail-${key}`">{{ field.editor?.label ?? key }} <span v-if="field.required && field.default === undefined" class="req">*</span><small>{{ field.type }}</small></label>
						<textarea
							:id="`fe-detail-${key}`"
							:rows="Math.min(8, Math.max(2, settingText(step.config?.[key]).split('\n').length))"
							:value="settingText(step.config?.[key])"
							:disabled="!editable"
							spellcheck="false"
							@focus="lastField = $event.target as HTMLTextAreaElement"
							@input="setSetting(String(key), ($event.target as HTMLTextAreaElement).value)"
						/>
						<div class="preview">Becomes: <b>{{ preview(settingText(step.config?.[key])) || '—' }}</b></div>
					</div>
					<p v-if="!Object.keys(fields).length" class="note">This block has no settings.</p>
				</section>
				<section>
					<h3>Output</h3>
					<template v-if="record">
						<span class="pill" :class="{ ok: record.status === 'completed', bad: record.status === 'failed' }">{{ record.exit ? `${record.status} · ${record.exit}` : record.status }}</span>
						<pre class="code">{{ json(record.error ?? record.output) }}</pre>
					</template>
					<template v-else>
						<p class="note">Declared outputs:</p>
						<pre class="code">{{ json(block?.outputs ?? {}) }}</pre>
					</template>
					<p class="note">Later steps read these as <span class="ref" v-text="mustache(`${name}.field`)" />.</p>
				</section>
			</div>
		</div>
	</div>
</template>
