<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { SocialOpportunityData } from '../shared/SocialOpportunityData';

const props = defineProps<{ path?: string }>();
const emit = defineEmits<{ 'navigation-changed': [] }>();
const opportunities = ref<SocialOpportunityData[]>([]);
const title = ref('');
const url = ref('');
const notes = ref('');
const filter = ref('saved');
const busy = ref(false);
const error = ref('');
const visible = computed(() => opportunities.value.filter(item => filter.value === 'all' || item.status === filter.value));

/** Calls the host-mounted app API using its existing authenticated session. */
async function request(path = '', body?: unknown, method = 'GET') {
	const response = await fetch(`/api/apps/social/opportunities${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	const result = await response.json();
	if (!response.ok) throw new Error(result.message || 'Could not load Social.');
	return result;
}

/** Gives reads and writes one visible error and busy lifecycle. */
async function perform(operation: () => Promise<void>) {
	busy.value = true; error.value = '';
	try { await operation(); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Please try again.'; } finally { busy.value = false; }
}

/** Loads persisted opportunities for the current host-authenticated person. */
async function load() { opportunities.value = (await request()).opportunities; }

/** Saves a discussion for review; discovery and posting remain the person's actions. */
async function save() {
	await perform(async () => { await request('', { title: title.value, url: url.value, notes: notes.value }, 'POST'); emit('navigation-changed'); title.value = ''; url.value = ''; notes.value = ''; await load(); });
}

/** Records progress and refreshes the authoritative saved state. */
async function update(item: SocialOpportunityData, status: string) {
	await perform(async () => { await request(`/${item.id}`, { status }, 'PATCH'); emit('navigation-changed'); await load(); });
}

onMounted(() => perform(load));
</script>

<template>
	<section v-if="props.path === 'about'" class="max-w-2xl space-y-5">
		<h1 class="text-3xl font-semibold tracking-tight">A place for worthwhile conversations.</h1>
		<p class="leading-relaxed text-muted-fg">Save a question or discussion you discovered on Reddit, Quora, X, LinkedIn, Facebook or elsewhere. Record why it matters and what you can contribute, then keep track of your response.</p>
		<p class="leading-relaxed text-muted-fg">Your saved discussions are private to your account. Social does not monitor platforms or publish replies. Open the discussion, check its rules and contribute in your own voice.</p>
	</section>
	<section v-else-if="!props.path" class="space-y-8">
		<div><p class="text-xs font-medium uppercase tracking-widest text-muted-fg">Social</p><h1 class="mt-2 text-3xl font-semibold tracking-tight">Conversations worth joining</h1><p class="mt-3 text-muted-fg">Keep the questions where you have something useful to add.</p></div>
		<p v-if="error" role="alert" class="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">{{ error }}</p>
		<div class="grid items-start gap-8 xl:grid-cols-[320px_1fr]">
			<form class="space-y-4 rounded-2xl border border-border p-5" @submit.prevent="save">
				<h2 class="text-lg font-semibold">Save a discussion</h2>
				<label class="block text-sm">Question or title<input v-model="title" class="form-input mt-2" required maxlength="200" placeholder="Which UI library should I use?"></label>
				<label class="block text-sm">Discussion link<input v-model="url" class="form-input mt-2" type="url" required maxlength="2048" placeholder="https://…"></label>
				<label class="block text-sm">What could you contribute?<textarea v-model="notes" class="form-input mt-2 min-h-28" maxlength="4000" placeholder="A useful example, first-hand experience, a trade-off…" /></label>
				<button class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg disabled:opacity-50" :disabled="busy">{{ busy ? 'Saving…' : 'Save opportunity' }}</button>
			</form>
			<div class="min-w-0">
				<div class="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 class="font-semibold">Your opportunities <span class="text-muted-fg">{{ visible.length }}</span></h2><label class="text-sm">Show <select v-model="filter" class="ml-2 rounded-lg border border-border bg-background p-2"><option value="saved">Saved</option><option value="answered">Answered</option><option value="dismissed">Dismissed</option><option value="all">All</option></select></label></div>
				<p v-if="!visible.length" class="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-fg">{{ busy ? 'Loading discussions…' : 'No discussions here yet. Save one to start your research.' }}</p>
				<article v-for="item in visible" :key="item.id" class="mb-4 space-y-4 rounded-2xl border border-border p-5">
					<div class="flex items-start justify-between gap-3"><h3 class="min-w-0 break-words text-lg font-medium">{{ item.title }}</h3><span class="rounded-full bg-muted px-2 py-1 text-xs">{{ item.status }}</span></div>
					<p v-if="item.notes" class="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-fg">{{ item.notes }}</p>
					<div class="flex flex-wrap items-center gap-4 text-sm"><a :href="item.url" target="_blank" rel="noopener noreferrer" class="font-medium underline underline-offset-4">Open discussion ↗</a><button v-if="item.status !== 'answered'" :disabled="busy" class="underline underline-offset-4" @click="update(item, 'answered')">Mark answered</button><button v-if="item.status !== 'dismissed'" :disabled="busy" class="text-muted-fg underline underline-offset-4" @click="update(item, 'dismissed')">Dismiss</button><button v-if="item.status !== 'saved'" :disabled="busy" class="underline underline-offset-4" @click="update(item, 'saved')">Save again</button></div>
				</article>
			</div>
		</div>
	</section>
	<p v-else role="alert">This Social page does not exist.</p>
</template>
