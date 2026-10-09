<script setup lang="ts">
import { computed } from 'vue';
import { History, RefreshCw } from '@lucide/vue';

import type { FlowRunDetailsRecord, FlowRunRecord } from './contracts';

const props = defineProps<{
	runs: FlowRunRecord[];
	details: FlowRunDetailsRecord | null;
	busy: boolean;
}>();

const emit = defineEmits<{
	'select-run': [runId: string];
	'select-block': [blockId: string];
	'replay-run': [runId: string, definition: 'original' | 'latest'];
}>();

const selectedRunId = computed(() => props.details?.run.id ?? null);

/**
 * Formats a persisted timestamp for the local run list.
 *
 * @param value - ISO-compatible timestamp.
 * @returns Compact local date and time.
 */
function formatTime(value: string | null): string {
	if (!value) return 'Pending';

	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).format(new Date(value));
}
</script>

<template>
	<section class="flow-run-panel">
		<div class="flow-run-list">
			<header>
				<History :size="15" />
				<strong>Recent runs</strong>
				<span>{{ runs.length }}</span>
			</header>
			<div class="flow-run-list__items">
				<button
					v-for="run in runs"
					:key="run.id"
					type="button"
					:class="{ 'is-selected': run.id === selectedRunId }"
					@click="emit('select-run', run.id)"
				>
					<span class="flow-status-dot" :class="`is-${run.status}`" />
					<span>
						<strong>{{ run.status }}</strong>
						<small>{{ formatTime(run.createdAt) }}</small>
					</span>
				</button>
				<p v-if="runs.length === 0" class="flow-empty-copy">No runs yet.</p>
			</div>
		</div>

		<div class="flow-run-timeline">
			<header>
				<div>
					<strong>{{ details ? `Run ${details.run.id.slice(-6)}` : 'Run timeline' }}</strong>
					<span v-if="details" class="flow-status" :class="`is-${details.run.status}`">{{ details.run.status }}</span>
				</div>
				<div v-if="details" class="flow-run-actions">
					<button type="button" :disabled="busy" @click="emit('replay-run', details.run.id, 'original')">
						<RefreshCw :size="14" />
						Replay snapshot
					</button>
					<button type="button" :disabled="busy" @click="emit('replay-run', details.run.id, 'latest')">
						Replay latest
					</button>
				</div>
			</header>

			<div v-if="details" class="flow-run-timeline__content">
				<button
					v-for="step in details.steps"
					:key="step.id"
					type="button"
					class="flow-timeline-step"
					@click="emit('select-block', step.blockId)"
				>
					<span class="flow-status-dot" :class="`is-${step.status}`" />
					<span>
						<strong>{{ step.blockName }}</strong>
						<small>{{ step.status }}<template v-if="step.attempt"> · attempt {{ step.attempt }}</template></small>
					</span>
				</button>
			</div>
			<p v-else class="flow-empty-copy">Run the flow or choose a previous run to see every block boundary.</p>
		</div>
	</section>
</template>
