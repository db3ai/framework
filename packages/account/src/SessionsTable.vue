<script setup lang="ts">
import { computed } from 'vue';
import { orderSessions, sessionTime, type AccountSession } from './sessions';

/**
 * "Where you're logged in": every signed-in device with where and when, this one marked Current.
 * The host owns the routes: it handles `log-out` for one other device and `log-out-all`.
 */
const props = defineProps<{ sessions: AccountSession[]; busy?: boolean }>();
defineEmits<{ 'log-out': [session: AccountSession]; 'log-out-all': [] }>();

const rows = computed(() => orderSessions(props.sessions));
</script>

<template>
	<section class="text-sm" data-account-sessions>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h3 class="text-base font-semibold text-canvas-fg">Where you're logged in</h3>
			<button type="button" class="min-h-9 rounded-lg bg-muted px-3 font-medium text-canvas-fg hover:bg-muted/70 disabled:opacity-50" :disabled="busy" data-log-out-all @click="$emit('log-out-all')">Log out of all devices</button>
		</div>
		<table class="mt-4 w-full table-fixed text-left">
			<thead class="text-muted-fg">
				<tr class="border-b border-border">
					<th class="py-2 pr-4 font-normal">Device</th>
					<th class="hidden py-2 pr-4 font-normal md:table-cell">Location</th>
					<th class="hidden py-2 pr-4 font-normal lg:table-cell">Signed in</th>
					<th class="w-36 py-2 pr-4 font-normal">Last active</th>
					<th class="w-20 py-2"><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-border">
				<tr v-for="session in rows" :key="session.id" data-session>
					<td class="py-3 pr-4">
						<span class="flex min-w-0 items-center gap-2">
							<span class="truncate text-canvas-fg" :title="session.label">{{ session.label }}</span>
							<span v-if="session.current" class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary" data-current>Current</span>
						</span>
						<span class="block truncate text-xs text-muted-fg md:hidden">{{ session.location ?? 'Unknown' }}</span>
					</td>
					<td class="hidden truncate py-3 pr-4 text-muted-fg md:table-cell">{{ session.location ?? 'Unknown' }}</td>
					<td class="hidden py-3 pr-4 text-muted-fg lg:table-cell">{{ sessionTime(session.createdAt) }}</td>
					<td class="py-3 pr-4 text-muted-fg">{{ sessionTime(session.lastUsedAt ?? session.createdAt) }}</td>
					<td class="py-3 text-right">
						<button v-if="!session.current" type="button" class="rounded px-1 text-muted-fg hover:text-canvas-fg disabled:opacity-50" :disabled="busy" data-log-out @click="$emit('log-out', session)">Log out</button>
					</td>
				</tr>
			</tbody>
		</table>
	</section>
</template>
