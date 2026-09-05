<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { DomButton } from '@getdom/studio/vue';
import ThemeToggle from './ThemeToggle.vue';
import { api } from './api';

/** Public, deliberately limited account view. */
interface User { id: string; name: string; email: string }
/** Note JSON returned through the model's field serialization. */
interface Note { id: string; title: string; body: string }
const config = ref({ name: 'My DB3 app', aiEnabled: false });
const user = ref<User | null>(null);
const notes = ref<Note[]>([]);
const page = ref('home');
const ready = ref(false);
const busy = ref(false);
const error = ref('');
const name = ref('');
const email = ref('');
const password = ref('');
const title = ref('');
const body = ref('');
const summaries = ref<Record<string, string>>({});
const summarising = ref('');

/** Runs UI work with a visible failure state and reliable busy cleanup. */
async function perform(work: () => Promise<void>) {
	error.value = '';
	busy.value = true;
	try { await work(); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Something went wrong.'; } finally { busy.value = false; }
}

/** Loads private notes only after a verified authenticated session. */
async function loadNotes() { notes.value = (await api<{ notes: Note[] }>('/notes')).notes; }

/** Refreshes authentication from the server, not local storage or an optimistic flag. */
async function refreshSession() {
	user.value = (await api<{ user: User | null }>('/me')).user;
	if (user.value) { await loadNotes(); page.value = 'notes'; } else { notes.value = []; summaries.value = {}; }
}

/** Registers or signs in; passwords are cleared once the attempt finishes. */
async function authenticate() {
	await perform(async () => {
		try { await api(page.value === 'register' ? '/register' : '/login', { email: email.value, password: password.value, ...(page.value === 'register' ? { name: name.value } : {}) }); } finally { password.value = ''; }
		await refreshSession();
	});
}

/** Saves a note with server-assigned ownership and refreshes persisted results. */
async function saveNote() {
	await perform(async () => { await api('/notes', { title: title.value, body: body.value }); title.value = ''; body.value = ''; await loadNotes(); });
}

/** Requests AI only after an explicit click and never replaces the source note. */
async function summarise(note: Note) {
	summarising.value = note.id;
	await perform(async () => { const result = await api<{ text: string }>(`/notes/${note.id}/summarise`, {}); summaries.value[note.id] = result.text; });
	summarising.value = '';
}

/** Removes a persisted note following the user's explicit confirmation. */
async function deleteNote(note: Note) {
	if (!window.confirm(`Delete “${note.title}”?`)) return;
	await perform(async () => { await api(`/notes/${note.id}`, undefined, 'DELETE'); delete summaries.value[note.id]; await loadNotes(); });
}

/** Revokes the server session before clearing the private screen. */
async function logout() {
	await perform(async () => { await api('/logout', {}); user.value = null; notes.value = []; summaries.value = {}; page.value = 'home'; });
}

onMounted(async () => {
	await perform(async () => { config.value = await api('/config'); document.title = config.value.name; await refreshSession(); });
	ready.value = true;
});
</script>

<template>
	<div class="min-h-screen">
		<header class="border-b border-border">
			<nav aria-label="Main navigation" class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5">
				<a href="/" class="text-lg font-semibold tracking-tight">{{ config.name }}</a>
				<div class="flex items-center gap-3">
					<ThemeToggle />
					<template v-if="user"><span class="hidden text-sm text-muted-fg sm:inline">{{ user.name }}</span><DomButton variant="ghost" :disabled="busy" @click="logout">Sign out</DomButton></template>
					<template v-else><DomButton variant="ghost" @click="page = 'login'; error = ''">Sign in</DomButton><DomButton @click="page = 'register'; error = ''">Get started</DomButton></template>
				</div>
			</nav>
		</header>
		<main class="mx-auto max-w-6xl px-6 py-10 sm:py-16">
			<p v-if="error" role="alert" class="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">{{ error }}</p>
			<p v-if="!ready" role="status">Loading your app…</p>
			<section v-else-if="page === 'home' && !user" class="max-w-3xl py-12 sm:py-20">
				<p class="mb-6 text-sm font-medium uppercase tracking-widest text-muted-fg">Built with DB3</p>
				<h1 class="text-5xl font-semibold leading-tight tracking-tight sm:text-7xl">Your app starts here.</h1>
				<p class="mt-6 max-w-xl text-lg leading-relaxed text-muted-fg">Sign in. Save a note. Put AI to work. A small, working app you can make your own.</p>
				<div class="mt-9 flex flex-wrap gap-3"><DomButton size="lg" @click="page = 'register'">Create your account</DomButton><DomButton as="a" variant="secondary" href="https://db3.ai/docs" size="lg">Explore the framework</DomButton></div>
				<div class="mt-16 grid gap-8 border-t border-border pt-8 sm:grid-cols-3"><div><h2 class="font-semibold">Your account</h2><p class="mt-2 text-sm text-muted-fg">Password login and private sessions.</p></div><div><h2 class="font-semibold">Your notes</h2><p class="mt-2 text-sm text-muted-fg">Real records saved in your database.</p></div><div><h2 class="font-semibold">Your AI key</h2><p class="mt-2 text-sm text-muted-fg">Optional AI, configured on your server.</p></div></div>
			</section>
			<section v-else-if="!user" class="mx-auto max-w-md py-8">
				<h1 class="text-3xl font-semibold tracking-tight">{{ page === 'register' ? 'Make yourself at home.' : 'Welcome back.' }}</h1>
				<p class="mt-3 text-muted-fg">{{ page === 'register' ? 'Create an account to start your private notebook.' : 'Sign in to your notebook.' }}</p>
				<form class="mt-8 space-y-5" @submit.prevent="authenticate">
					<label v-if="page === 'register'" class="block text-sm">Name<input v-model="name" class="form-input mt-2" autocomplete="name" required maxlength="120"></label>
					<label class="block text-sm">Email<input v-model="email" class="form-input mt-2" type="email" autocomplete="email" required maxlength="255"></label>
					<label class="block text-sm">Password<input v-model="password" class="form-input mt-2" type="password" :autocomplete="page === 'register' ? 'new-password' : 'current-password'" required minlength="12" maxlength="128"><span class="mt-2 block text-xs text-muted-fg">At least 12 characters.</span></label>
					<DomButton type="submit" class="w-full" :loading="busy">{{ page === 'register' ? 'Create account' : 'Sign in' }}</DomButton>
				</form>
			</section>
			<section v-else class="grid gap-10 lg:grid-cols-[200px_1fr]">
				<aside><p class="text-xs font-medium uppercase tracking-widest text-muted-fg">Your workspace</p><h1 class="mt-4 text-2xl font-semibold tracking-tight">Notebook</h1><p class="mt-3 text-sm leading-relaxed text-muted-fg">A working example of Auth, ActiveRecord and AI.</p><a class="mt-6 inline-block text-sm underline underline-offset-4" href="https://db3.ai/docs/active-record">Build your next feature</a></aside>
				<div class="min-w-0">
					<form class="space-y-4 border-b border-border pb-8" @submit.prevent="saveNote">
						<h2 class="text-xl font-semibold">Create a note</h2>
						<label class="block text-sm">Title<input v-model="title" class="form-input mt-2" placeholder="What are you working on?" required maxlength="120"></label>
						<label class="block text-sm">Note<textarea v-model="body" class="form-input mt-2 min-h-36" placeholder="Write something worth keeping…" required maxlength="20000" /></label>
						<DomButton type="submit" :loading="busy && !summarising">Save note</DomButton>
					</form>
					<p v-if="!config.aiEnabled" class="my-6 text-sm leading-relaxed text-muted-fg">AI is optional. Add your own <code class="font-mono">OPENAI_API_KEY</code> to the server’s <code class="font-mono">.env</code> file and restart to enable summaries. Never put the key in browser code.</p>
					<p v-else class="my-6 text-sm text-muted-fg">Summarising sends that saved note to OpenAI using the app owner’s API key. Provider charges apply. Review AI output before using it.</p>
					<p v-if="!notes.length" class="py-8 text-muted-fg">Your first note will appear here once you save it.</p>
					<article v-for="note in notes" :key="note.id" class="border-b border-border py-7">
						<h2 class="break-words text-lg font-semibold">{{ note.title }}</h2><p class="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-fg">{{ note.body }}</p>
						<div class="mt-5 flex gap-2"><DomButton variant="secondary" size="sm" :disabled="!config.aiEnabled || busy" :loading="summarising === note.id" @click="summarise(note)">Summarise with AI</DomButton><DomButton variant="ghost" size="sm" :disabled="busy" @click="deleteNote(note)">Delete</DomButton></div>
						<div v-if="summaries[note.id]" class="mt-5 border-l-2 border-primary pl-4" role="status"><h3 class="text-sm font-medium">AI summary</h3><p class="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{{ summaries[note.id] }}</p></div>
					</article>
				</div>
			</section>
		</main>
	</div>
</template>
