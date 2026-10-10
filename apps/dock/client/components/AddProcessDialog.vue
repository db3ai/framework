<script setup lang="ts">
import { computed, ref, toRef } from 'vue';

import type { ProjectDefinition } from '../../shared/contracts.js';
import { useAddProcess, type AddKind } from '../dock/useAddProcess.js';
import Icon from './Icon.vue';
import KindTile from './KindTile.vue';
import ModalDialog from './ModalDialog.vue';

/**
 * Adds queue workers, a scheduler or any other npm script to a project.
 * Queue names and worker pools come from a scan of the project's source.
 */
const props = defineProps<{ project: ProjectDefinition }>();
const emit = defineEmits<{ close: [] }>();

const target = computed(() => ({ id: props.project.id, name: props.project.name }));
const add = useAddProcess(target);
const { form } = add;
const newQueue = ref('');
const running = computed(() => new Set(props.project.processes.map(process => process.script)));

const kinds: Array<{ id: AddKind; label: string; script: () => string | null }> = [
	{ id: 'queue', label: 'Queue worker', script: () => add.queueScript.value },
	{ id: 'scheduler', label: 'Scheduler', script: () => add.schedulerScript.value },
	{ id: 'script', label: 'Other script', script: () => '…' },
];

const modes = [
	{ id: 'queues', label: 'Specific queues' },
	{ id: 'all', label: 'All queues except…' },
	{ id: 'pool', label: 'Worker pool' },
] as const;

const chipList = computed(() => (form.mode === 'all' ? form.excluded : form.picked));

const cta = computed(() => {
	if (form.kind === 'queue') return add.count.value > 1 ? `Add ${add.count.value} workers` : 'Add worker';
	if (form.kind === 'scheduler') return 'Add scheduler';
	return 'Add process';
});

function addTypedQueue(): void {
	add.addQueueName(newQueue.value);
	newQueue.value = '';
}

async function submit(): Promise<void> {
	if (await add.submit()) emit('close');
}

const projectPath = toRef(() => props.project.path);
</script>

<template>
	<ModalDialog :title="`Add process to ${props.project.name}`" :subtitle="projectPath" :width="760" @close="emit('close')">
		<div class="kinds" role="radiogroup" aria-label="Process kind">
			<button
				v-for="kind in kinds"
				:key="kind.id"
				type="button"
				role="radio"
				class="kind"
				:class="{ 'kind--on': form.kind === kind.id }"
				:aria-checked="form.kind === kind.id"
				@click="form.kind = kind.id"
			>
				<KindTile :kind="kind.id" />
				<span class="kind-label">{{ kind.label }}</span>
				<span class="kind-cmd mono">{{ kind.script() ? `npm run ${kind.script()}` : 'no script found' }}</span>
			</button>
		</div>

		<p v-if="add.loading.value" class="muted">Reading package.json and queue config…</p>

		<template v-if="form.kind === 'queue'">
			<p v-if="!add.loading.value && !add.queueScript.value" class="warn">This project has no <span class="mono">queue</span> script in package.json.</p>
			<template v-else>
				<div class="stack">
					<div class="eyebrow">Which jobs should it take?</div>
					<div class="segmented" role="radiogroup" aria-label="Queue selection">
						<button v-for="mode in modes" :key="mode.id" type="button" role="radio" :aria-checked="form.mode === mode.id" :class="{ on: form.mode === mode.id }" @click="form.mode = mode.id">{{ mode.label }}</button>
					</div>
				</div>

				<div v-if="form.mode === 'pool'" class="stack">
					<template v-if="add.topology.value.pools.length">
						<div role="radiogroup" aria-label="Worker pool" class="stack tight">
							<button v-for="pool in add.topology.value.pools" :key="pool" type="button" role="radio" class="option" :class="{ 'option--on': form.pool === pool }" :aria-checked="form.pool === pool" @click="form.pool = pool">
								<span class="radio" />
								<span class="mono">{{ pool }}</span>
							</button>
						</div>
					</template>
					<p v-else class="muted">No worker pools found. Pools are declared with <span class="mono">runQueueConsole({ workers: { name: { queues } } })</span>.</p>
					<label class="field inline">
						Pool name
						<input v-model="form.pool" class="mono" type="text" placeholder="general" autocomplete="off">
					</label>
				</div>

				<div v-else class="stack">
					<div class="hint-strong">{{ form.mode === 'all' ? 'Take every queue, except the ones you select' : 'Take only these queues' }}</div>
					<div class="chips">
						<button
							v-for="queue in add.topology.value.queues"
							:key="queue"
							type="button"
							class="chip mono"
							:class="{ 'chip--on': chipList.includes(queue), 'chip--excluded': form.mode === 'all' && chipList.includes(queue) }"
							:aria-pressed="chipList.includes(queue)"
							@click="add.toggleQueue(queue)"
						>{{ queue }}</button>
						<form class="chip-add" @submit.prevent="addTypedQueue">
							<label class="visually-hidden" for="new-queue">Another queue name</label>
							<input id="new-queue" v-model="newQueue" class="mono" type="text" placeholder="another queue…" autocomplete="off">
							<button type="submit" class="icon-btn icon-btn--ghost" aria-label="Add queue name"><Icon name="plus" :size="14" /></button>
						</form>
					</div>
					<span class="muted small">Queue names found in this app's source. Add any that are built dynamically.</span>
				</div>

				<div class="row">
					<div class="stack tight">
						<span id="count-label" class="hint-strong">Worker processes</span>
						<div class="stepper" role="group" aria-labelledby="count-label">
							<button type="button" aria-label="One fewer worker" :disabled="form.count <= 1" @click="form.count--">−</button>
							<output class="mono" aria-live="polite">{{ form.count }}</output>
							<button type="button" aria-label="One more worker" :disabled="form.count >= 16" @click="form.count++">+</button>
						</div>
					</div>
					<span class="muted small grow">Each worker runs one job at a time. For more jobs at once, add more workers.</span>
				</div>

				<details class="advanced">
					<summary>Advanced</summary>
					<div class="grid3">
						<label class="field">Polling interval (ms)<input v-model="form.interval" class="mono" type="text" inputmode="numeric" placeholder="default"></label>
						<label class="field">Max jobs per tick<input v-model="form.maxJobs" class="mono" type="text" inputmode="numeric" placeholder="default"></label>
						<label class="field">Process name<input v-model="form.processTitle" class="mono" type="text" :placeholder="add.suggestedTitle.value"></label>
					</div>
				</details>
			</template>
		</template>

		<div v-else-if="form.kind === 'scheduler'" class="note">
			<p v-if="!add.loading.value && !add.schedulerScript.value" class="warn">This project has no <span class="mono">scheduler</span> script in package.json.</p>
			<template v-else>
				<strong>Scheduler worker</strong>
				<span>Keeps running and checks the app's schedules every minute. When a scheduled job is due it's sent to the queue, so a queue worker still runs it.</span>
			</template>
		</div>

		<div v-else class="stack">
			<div class="hint-strong">Scripts in package.json</div>
			<div class="scripts" role="radiogroup" aria-label="npm script">
				<button
					v-for="script in add.scripts.value"
					:key="script.name"
					type="button"
					role="radio"
					class="script"
					:class="{ 'script--on': form.script === script.name }"
					:aria-checked="form.script === script.name"
					@click="form.script = script.name"
				>
					<span class="radio" />
					<span class="script-name">{{ script.name }}</span>
					<span class="script-body mono">{{ script.body }}</span>
					<span v-if="running.has(script.name)" class="pill">added</span>
				</button>
			</div>
		</div>

		<div class="stack">
			<div class="eyebrow">Will run</div>
			<div class="preview mono">
				<span class="dollar">$</span>
				<span class="cmd">{{ add.command.value || '—' }}</span>
				<span v-if="add.count.value > 1" class="times">× {{ add.count.value }}</span>
			</div>
		</div>

		<p v-if="add.error.value" class="error" role="alert">{{ add.error.value }}</p>

		<template #footer>
			<label class="check"><input v-model="form.save" type="checkbox"> Save to project</label>
			<label class="check"><input v-model="form.start" type="checkbox"> Start now</label>
			<span class="spacer" />
			<button type="button" class="btn big" @click="emit('close')">Cancel</button>
			<button type="button" class="btn btn--primary big" :disabled="!add.plan.value || add.submitting.value" @click="submit">{{ cta }}</button>
		</template>
	</ModalDialog>
</template>

<style scoped>
.kinds {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 10px;
}

.kind {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6px;
	padding: 14px;
	border-radius: 10px;
	border: 1px solid var(--line);
	background: transparent;
	text-align: left;
}

.kind--on {
	background: var(--raised);
	border-color: var(--link);
	box-shadow: 0 0 0 1px var(--link);
}

.kind-label {
	font-weight: 600;
	margin-top: 4px;
}

.kind-cmd {
	font-size: 12px;
	color: var(--muted);
}

.stack {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.tight {
	gap: 6px;
}

.segmented {
	display: flex;
	flex-wrap: wrap;
	align-self: flex-start;
	padding: 3px;
	gap: 2px;
	border-radius: 9px;
	background: var(--ground);
	border: 1px solid var(--line);
}

.segmented button {
	height: 34px;
	padding: 0 14px;
	border-radius: 7px;
	border: 0;
	background: transparent;
	color: var(--muted);
	font-size: 13px;
}

.segmented button.on {
	background: var(--raised-hi);
	color: var(--text);
}

.option {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 44px;
	padding: 0 14px;
	border-radius: 10px;
	border: 1px solid var(--line);
	background: transparent;
	text-align: left;
}

.option--on {
	background: var(--raised);
	border-color: var(--kind-queue);
}

.radio {
	width: 16px;
	height: 16px;
	flex: none;
	border-radius: 50%;
	border: 2px solid var(--faint);
}

.option--on .radio,
.script--on .radio {
	border: 5px solid var(--link);
}

.hint-strong {
	font-size: 13px;
	color: var(--text-2);
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}

.chip {
	height: 36px;
	padding: 0 14px;
	border-radius: 999px;
	border: 1px solid var(--line-strong);
	background: transparent;
	font-size: 12px;
}

.chip--on {
	border-color: var(--kind-queue);
	background: color-mix(in srgb, var(--kind-queue) 16%, transparent);
}

.chip--excluded {
	border-color: var(--bad);
	background: color-mix(in srgb, var(--bad) 12%, transparent);
	text-decoration: line-through;
}

.chip-add {
	display: flex;
	align-items: center;
	height: 36px;
	padding-left: 12px;
	border-radius: 999px;
	border: 1px dashed var(--line-strong);
}

.chip-add input {
	width: 130px;
	background: transparent;
	border: 0;
	outline: none;
	font-size: 12px;
}

.row {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 16px 28px;
}

.grow {
	flex: 1 1 260px;
}

.stepper {
	display: flex;
	align-items: center;
	border: 1px solid var(--line-strong);
	border-radius: 9px;
	overflow: hidden;
	align-self: flex-start;
}

.stepper button {
	width: 44px;
	height: 40px;
	border: 0;
	background: var(--raised);
	font-size: 18px;
}

.stepper output {
	width: 52px;
	text-align: center;
	font-size: 15px;
}

.advanced {
	border: 1px solid var(--line);
	border-radius: 10px;
	padding: 0 14px;
}

.advanced summary {
	cursor: pointer;
	padding: 12px 0;
	font-size: 13px;
	color: var(--text-2);
}

.grid3 {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 12px;
	padding: 4px 0 14px;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 6px;
	font-size: 12px;
	color: var(--muted);
}

.field.inline {
	max-width: 280px;
}

.field input {
	height: 38px;
	padding: 0 10px;
	border-radius: 7px;
	border: 1px solid var(--line-strong);
	background: var(--ground);
	color: var(--text);
	font-size: 13px;
}

.note {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 14px 16px;
	border: 1px solid var(--line);
	border-radius: 10px;
	background: var(--bar);
	font-size: 13px;
	line-height: 1.55;
	color: var(--text-2);
}

.scripts {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--line);
	border-radius: 10px;
	overflow: hidden;
}

.script {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 46px;
	padding: 0 14px;
	border: 0;
	border-top: 1px solid var(--line-soft);
	background: transparent;
	text-align: left;
}

.script:first-child {
	border-top: 0;
}

.script--on {
	background: var(--raised);
}

.script-name {
	width: 140px;
	font-weight: 500;
}

.script-body {
	flex: 1;
	min-width: 0;
	font-size: 12px;
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.pill {
	font-size: 11px;
	color: var(--muted);
	border: 1px solid var(--line-strong);
	border-radius: 999px;
	padding: 2px 8px;
}

.preview {
	display: flex;
	gap: 10px;
	align-items: flex-start;
	background: var(--ground-deep);
	border: 1px solid var(--line);
	border-radius: 10px;
	padding: 12px 14px;
	font-size: 12.5px;
	line-height: 1.7;
	color: var(--text-2);
}

.dollar {
	color: var(--kind-queue);
}

.cmd {
	flex: 1;
	min-width: 0;
	word-break: break-all;
}

.times {
	color: var(--muted);
	white-space: nowrap;
}

.muted {
	margin: 0;
	color: var(--muted);
	font-size: 13px;
}

.small {
	font-size: 12px;
}

.warn {
	margin: 0;
	color: var(--warn);
	font-size: 13px;
}

.error {
	margin: 0;
	color: var(--bad);
	font-size: 13px;
}

.check {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
	color: var(--text-2);
	min-height: 44px;
}

.check input {
	width: 18px;
	height: 18px;
	accent-color: var(--accent);
}

.spacer {
	flex: 1;
}

.big {
	height: 40px;
	padding: 0 16px;
	font-size: 13px;
}

@media (max-width: 640px) {
	.kinds,
	.grid3 {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
