<script setup lang="ts">
import { computed, markRaw, onMounted, onUnmounted, ref, shallowRef, watch, type Component } from 'vue';
import type { AppDescription, AppAction, AppNavigationResult } from '@db3.ai/app/apps/contracts';
import clients from 'virtual:db3/apps';
import { api } from './api';

const props = defineProps<{ route: string }>();
const catalog = ref<AppDescription[]>([]);
const navigation = ref<AppNavigationResult>({ apps: [], unavailable: [] });
const navigationError = ref('');
const canManage = ref(false);
const busy = ref('');
const loaded = ref(false);
const error = ref('');
const component = shallowRef<Component>();
const appId = computed(() => props.route.split('/')[1] ?? '');
const path = computed(() => props.route.split('/').slice(2).join('/'));
const selected = computed(() => catalog.value.find(item => item.manifest.id === appId.value && item.ready));
let revision = 0;
let navigationRevision = 0;
let disposed = false;

/** Refreshes all app contributions together without remounting the open app or retaining stale results. */
async function refreshNavigation() {
	if (disposed) return;
	const current = ++navigationRevision;
	try {
		const result = await api<AppNavigationResult>('/app-navigation');
		if (current !== navigationRevision) return;
		navigation.value = result;
		navigationError.value = result.unavailable.length ? 'Some app navigation is unavailable. Try refreshing.' : '';
	} catch {
		if (current !== navigationRevision) return;
		navigation.value = { apps: [], unavailable: [] };
		navigationError.value = 'Could not refresh app navigation.';
	}
}

/** Loads a compiled client entry only after the host catalog confirms the app is ready. */
async function loadApp() {
	const current = ++revision;
	component.value = undefined;
	error.value = '';
	if (!selected.value) return;
	const client = clients.find(item => item.id === selected.value!.manifest.id);
	if (!client) { error.value = 'This app has no interface in this build. Rebuild the host after adding its code.'; return; }
	try {
		const module = await client.load();
		if (revision === current) component.value = markRaw(module.default);
	} catch { if (revision === current) error.value = 'Could not open this app. Please reload and try again.'; }
}

/** Applies an administrator action and refreshes navigation from the resulting durable state. */
async function manage(id: string, action: AppAction) {
	busy.value = id;
	error.value = '';
	try { catalog.value = (await api<{ apps: AppDescription[] }>(`/app-management/${id}/${action}`, {})).apps; await refreshNavigation(); }
	catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not update this app.'; }
	finally { busy.value = ''; }
}

watch(selected, loadApp);
onMounted(async () => {
	window.addEventListener('focus', refreshNavigation);
	try { const result = await api<{ apps: AppDescription[]; canManage: boolean }>('/apps'); catalog.value = result.apps; canManage.value = result.canManage; }
	catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load apps.'; }
	finally { loaded.value = true; }
	await refreshNavigation();
});
onUnmounted(() => { disposed = true; revision++; navigationRevision++; window.removeEventListener('focus', refreshNavigation); });
</script>

<template>
	<div class="grid gap-8 md:grid-cols-[180px_minmax(0,1fr)]">
		<aside>
			<a href="#apps" class="text-xs font-semibold uppercase tracking-widest text-muted-fg">Workspace apps</a>
			<nav aria-label="App navigation" class="mt-5 space-y-5">
				<div v-for="item in navigation.apps" :key="item.appId">
					<a :href="`#apps/${item.appId}`" :aria-current="appId === item.appId ? 'page' : undefined" class="flex items-center gap-2 font-medium"><span aria-hidden="true">{{ item.icon || '◇' }}</span>{{ item.name }}<span v-if="item.badge" :aria-label="item.badge.label" class="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{{ item.badge.count }}</span></a>
					<p v-if="item.description" class="ml-6 mt-2 text-xs text-muted-fg">{{ item.description }}</p>
					<div v-if="appId === item.appId" class="ml-6 mt-3 space-y-3">
						<a v-for="link in item.items" :key="link.id" :href="`#apps/${item.appId}${link.path ? `/${link.path}` : ''}`" :aria-current="path === link.path ? 'page' : undefined" class="block text-sm text-muted-fg underline-offset-4 hover:underline"><span class="flex items-center gap-2">{{ link.label }}<span v-if="link.badge" :aria-label="link.badge.label" class="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{{ link.badge.count }}</span></span><span v-if="link.description" class="mt-1 block text-xs">{{ link.description }}</span></a>
					</div>
				</div>
			</nav>
			<p v-if="navigationError" role="status" class="mt-4 text-xs text-muted-fg">{{ navigationError }}</p>
			<button class="mt-5 text-xs text-muted-fg underline underline-offset-4" @click="refreshNavigation">Refresh navigation</button>
		</aside>
		<div class="min-w-0">
			<p v-if="error" role="alert" class="mb-5 rounded-xl border border-border p-4">{{ error }}</p>
			<p v-if="!loaded" role="status">Loading apps…</p>
			<template v-else-if="!appId">
				<h1 class="text-3xl font-semibold tracking-tight">Your apps, at a glance.</h1>
				<p class="mt-3 text-muted-fg">Explore the features that make up this workspace.</p>
				<div class="mt-8 grid gap-5 lg:grid-cols-2">
					<article v-for="item in catalog" :key="item.manifest.id" class="rounded-2xl border border-border p-6">
						<div class="flex items-center justify-between gap-4"><h2 class="text-xl font-semibold"><span aria-hidden="true" class="mr-2">{{ item.manifest.icon || '◇' }}</span>{{ item.manifest.name }}</h2><span class="text-xs text-muted-fg">{{ item.state === 'available' ? 'Not installed' : item.state }}</span></div>
						<p class="mt-4 text-sm leading-relaxed text-muted-fg">{{ item.manifest.description }}</p>
						<a v-if="item.ready" :href="`#apps/${item.manifest.id}`" class="mt-5 inline-block font-medium underline underline-offset-4">Open {{ item.manifest.name }} →</a>
						<p v-else class="mt-5 text-sm text-muted-fg">This app is not currently available. An administrator can manage its installation.</p>
						<div v-if="canManage && item.registered" class="mt-5 flex flex-wrap gap-3">
							<button v-if="['available', 'uninstalled', 'failed'].includes(item.state) || item.installedVersion !== item.manifest.version" :disabled="Boolean(busy)" class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-fg disabled:opacity-50" @click="manage(item.manifest.id, 'install')">{{ busy === item.manifest.id ? 'Updating…' : item.installedVersion && item.installedVersion !== item.manifest.version ? 'Update' : 'Install' }}</button>
							<button v-if="item.state === 'disabled'" :disabled="Boolean(busy)" class="rounded-lg border border-border px-4 py-2 text-sm" @click="manage(item.manifest.id, 'enable')">Enable</button>
							<button v-if="item.state === 'enabled'" :disabled="Boolean(busy)" class="rounded-lg border border-border px-4 py-2 text-sm" @click="manage(item.manifest.id, 'disable')">Disable</button>
							<button v-if="['enabled', 'disabled', 'failed'].includes(item.state)" :disabled="Boolean(busy)" class="rounded-lg border border-border px-4 py-2 text-sm" @click="manage(item.manifest.id, 'uninstall')">Uninstall · keep data</button>
						</div>
						<details class="mt-6 border-t border-border pt-4 text-sm"><summary class="cursor-pointer">Explore definition</summary><dl class="mt-4 space-y-3"><div><dt class="text-muted-fg">Identifier · version</dt><dd>{{ item.manifest.id }} · {{ item.manifest.version }}</dd></div><div><dt class="text-muted-fg">Models</dt><dd v-for="model in item.models" :key="model.table" class="break-all">{{ model.name }} <span class="text-muted-fg">{{ model.table }}</span></dd><dd v-if="!item.models.length">{{ item.installedVersion ? 'None' : 'Available after installation' }}</dd></div><div><dt class="text-muted-fg">Routes</dt><dd v-for="route in item.routes" :key="`${route.method} ${route.path}`" class="break-all">{{ route.method }} {{ route.path }}</dd></div><div><dt class="text-muted-fg">Required apps</dt><dd>{{ Object.keys(item.manifest.requires || {}).join(', ') || 'None' }}</dd></div></dl></details>
					</article>
				</div>
				<p v-if="!catalog.length" class="mt-8 text-muted-fg">No apps were discovered in this workspace.</p>
			</template>
			<p v-else-if="!selected" role="alert">This app is unavailable. <a href="#apps" class="underline">View workspace apps</a></p>
			<component :is="component" v-else-if="component" :key="appId" :path="path" @navigation-changed="refreshNavigation" />
			<p v-else-if="!error" role="status">Opening app…</p>
		</div>
	</div>
</template>
