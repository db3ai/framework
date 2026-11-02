<script setup lang="ts">
import { ref, watch } from 'vue';
import type { FlowRunStatus } from '@db3.ai/app/flows';
import type { FlowEditorClient, FlowRunRecord } from '../contracts';

/**
 * A flow's runs, newest first, with search, a status filter and pages, so a flow
 * with hundreds of runs stays quick to look through.
 */
const props = defineProps<{
	client: FlowEditorClient;
	flowId: string;
	selectedRunId: string | null;
	/** Bumped by the parent to reload, such as after a test run. */
	refresh: number;
}>();

const emit = defineEmits<{ select: [runId: string] }>();

const PER_PAGE = 12;
const STATUSES: FlowRunStatus[] = ['queued', 'running', 'completed', 'failed'];

const search = ref('');
const status = ref<FlowRunStatus | ''>('');
const page = ref(1);
const runs = ref<FlowRunRecord[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
let request = 0;

async function load(): Promise<void> {
	if (!props.client.runs) return;
	const mine = ++request;
	loading.value = true;
	error.value = null;
	try {
		const result = await props.client.runs(props.flowId, { page: page.value, perPage: PER_PAGE, ...(status.value ? { status: status.value } : {}), ...(search.value.trim() ? { search: search.value.trim() } : {}) });
		if (mine !== request) return;
		runs.value = result.runs;
		total.value = result.total;
	} catch (caught) {
		if (mine === request) error.value = caught instanceof Error ? caught.message : String(caught);
	} finally {
		if (mine === request) loading.value = false;
	}
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
	clearTimeout(timer);
	timer = setTimeout(() => { page.value = 1; void load(); }, 250);
});
watch(status, () => { page.value = 1; void load(); });
watch(page, () => void load());
watch(() => [props.flowId, props.refresh], () => void load(), { immediate: true });

function when(run: FlowRunRecord): string {
	const date = new Date(run.createdAt);
	return Number.isNaN(date.getTime()) ? run.createdAt : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function took(run: FlowRunRecord): string {
	if (!run.startedAt || !run.completedAt) return '';
	const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
	return ms < 1000 ? ` · ${ms}ms` : ` · ${(ms / 1000).toFixed(1)}s`;
}

function summary(run: FlowRunRecord): string {
	return Object.values(run.input ?? {}).filter(value => typeof value === 'string').slice(0, 2).join(' · ');
}

const pages = () => Math.max(1, Math.ceil(total.value / PER_PAGE));
</script>

<template>
	<div class="field fe-runs">
		<span class="label">Runs</span>
		<div class="filters">
			<input v-model="search" placeholder="Search run id or input" aria-label="Search runs">
			<select v-model="status" aria-label="Status">
				<option value="">Any status</option>
				<option v-for="item in STATUSES" :key="item" :value="item">{{ item }}</option>
			</select>
		</div>
		<div class="rows list">
			<button v-for="run in runs" :key="run.id" :aria-pressed="run.id === selectedRunId" @click="emit('select', run.id)">
				<b class="mono">{{ run.id.slice(0, 10) }}…</b>
				<span class="pill" :class="{ ok: run.status === 'completed', bad: run.status === 'failed', acc: ['queued', 'running'].includes(run.status) }">{{ run.status }}</span>
				<small>{{ when(run) }}{{ took(run) }}{{ summary(run) ? ` · ${summary(run)}` : '' }}{{ run.replayOf ? ' · replay' : '' }}</small>
			</button>
			<div v-if="!runs.length" class="empty">{{ loading ? 'Loading…' : error ?? (search || status ? 'No runs match.' : 'No runs yet. Use Test run to start one.') }}</div>
		</div>
		<div class="pager">
			<button class="btn small" :disabled="page <= 1" @click="page--">Newer</button>
			<span>{{ total ? `${(page - 1) * PER_PAGE + 1}–${Math.min(total, page * PER_PAGE)} of ${total}` : '0 runs' }}</span>
			<button class="btn small" :disabled="page >= pages()" @click="page++">Older</button>
		</div>
	</div>
</template>
