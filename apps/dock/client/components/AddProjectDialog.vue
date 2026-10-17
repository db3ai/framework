<script setup lang="ts">
import { computed, ref } from 'vue';

import type { CreateAppDatabase } from '../../shared/contracts.js';
import { useDockContext } from '../dock/context.js';
import ModalDialog from './ModalDialog.vue';

/**
 * Adds a project folder, or creates a new db3 app with `create-db3` and adds
 * that. Dock picks up the project's api/dev/web/queue/scheduler scripts.
 */
const emit = defineEmits<{ close: []; added: [id: string, processId?: string] }>();

const { dock } = useDockContext();
const mode = ref<'add' | 'create'>('add');
const path = ref('');
const name = ref('');
const appName = ref('');
const folder = ref('~/Sites');
const database = ref<CreateAppDatabase>('docker');
const setup = ref(true);
const busy = ref(false);

const modes = [{ id: 'add', label: 'Add folder' }, { id: 'create', label: 'Create app' }] as const;
const databases = [{ id: 'docker', label: 'MariaDB in Docker' }, { id: 'local', label: 'Local MariaDB' }] as const;
const validName = computed(() => /^[a-z][a-z0-9-]{0,63}$/.test(appName.value.trim()));
const target = computed(() => `${folder.value.trim().replace(/\/+$/, '') || '.'}/${appName.value.trim() || 'my-app'}`);
const canSubmit = computed(() => !busy.value && (mode.value === 'add' ? !!path.value.trim() : validName.value && !!folder.value.trim()));

async function submit(): Promise<void> {
	if (!canSubmit.value) return;
	busy.value = true;
	if (mode.value === 'add') {
		const project = await dock.addProject(path.value, name.value || undefined);
		busy.value = false;
		if (project) emit('added', project.id);
		return;
	}
	const created = await dock.createApp({ name: appName.value.trim(), folder: folder.value, database: database.value, setup: setup.value });
	busy.value = false;
	if (created) emit('added', created.project.id, created.setupProcessId ?? undefined);
}
</script>

<template>
	<ModalDialog :title="mode === 'add' ? 'Add project' : 'Create app'" :subtitle="mode === 'add' ? 'A folder with a package.json' : 'A new db3 app from create-db3'" :width="560" @close="emit('close')">
		<form id="add-project" class="fields" @submit.prevent="submit">
			<div class="segmented" role="radiogroup" aria-label="Add or create">
				<button v-for="item in modes" :key="item.id" type="button" role="radio" :aria-checked="mode === item.id" :class="{ on: mode === item.id }" @click="mode = item.id; dock.clearError()">{{ item.label }}</button>
			</div>
			<template v-if="mode === 'add'">
				<label class="field">
					Folder
					<input v-model="path" class="mono" type="text" placeholder="~/Sites/scout" required autocomplete="off" spellcheck="false">
				</label>
				<label class="field">
					Name <span class="optional">(optional)</span>
					<input v-model="name" type="text" placeholder="Defaults to the folder name" autocomplete="off">
				</label>
				<p class="hint">Dock adds the project's <span class="mono">api</span>, <span class="mono">dev</span>, <span class="mono">web</span>, <span class="mono">queue</span> and <span class="mono">scheduler</span> scripts if it has them. Nothing starts until you press start.</p>
			</template>
			<template v-else>
				<label class="field">
					App name
					<input v-model="appName" class="mono" type="text" placeholder="my-app" required autocomplete="off" spellcheck="false" :aria-invalid="!!appName && !validName">
					<span v-if="appName && !validName" class="field-note">Start with a lowercase letter; use lowercase letters, numbers or hyphens.</span>
				</label>
				<label class="field">
					Create in
					<input v-model="folder" class="mono" type="text" placeholder="~/Sites" required autocomplete="off" spellcheck="false">
					<span class="field-note mono">{{ target }}</span>
				</label>
				<div class="field">
					Database
					<div class="segmented" role="radiogroup" aria-label="Database">
						<button v-for="item in databases" :key="item.id" type="button" role="radio" :aria-checked="database === item.id" :class="{ on: database === item.id }" @click="database = item.id">{{ item.label }}</button>
					</div>
				</div>
				<label class="check"><input v-model="setup" type="checkbox"> Install and migrate now</label>
				<p class="hint">
					Dock runs <span class="mono">create-db3</span> for the starter app (login, private notes, optional AI), then adds it here.
					<template v-if="setup && database === 'docker'"> A <span class="mono">setup</span> terminal starts MariaDB in Docker, runs <span class="mono">npm install</span> and migrations; then press start on <span class="mono">dev</span>.</template>
					<template v-else-if="setup"> A <span class="mono">setup</span> terminal waits while you set the <span class="mono">DB_</span> values in <span class="mono">.env</span>, then installs and migrates; then press start on <span class="mono">dev</span>.</template>
					<template v-else> Configure <span class="mono">.env</span>, run <span class="mono">npm install</span> and <span class="mono">npm run db:migrate</span> yourself, then press start on <span class="mono">dev</span>.</template>
				</p>
			</template>
			<p v-if="dock.error.value" class="error" role="alert">{{ dock.error.value }}</p>
		</form>
		<template #footer>
			<span class="spacer" />
			<button type="button" class="btn" @click="emit('close')">Cancel</button>
			<button type="submit" form="add-project" class="btn btn--primary" :disabled="!canSubmit">{{ mode === 'add' ? 'Add project' : busy ? 'Creating…' : 'Create app' }}</button>
		</template>
	</ModalDialog>
</template>

<style scoped>
.fields {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 6px;
	font-size: 13px;
	color: var(--text-2);
}

.field input {
	height: 40px;
	padding: 0 12px;
	border-radius: 8px;
	border: 1px solid var(--line-strong);
	background: var(--ground);
	color: var(--text);
}

.field-note {
	font-size: 12px;
	color: var(--muted);
}

.field input[aria-invalid='true'] {
	border-color: var(--bad);
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

.check {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
	color: var(--text-2);
}

.optional {
	color: var(--muted);
}

.hint {
	margin: 0;
	font-size: 12px;
	line-height: 1.55;
	color: var(--muted);
}

.error {
	margin: 0;
	color: var(--bad);
	font-size: 13px;
}

.spacer {
	flex: 1;
}

.btn {
	height: 40px;
	padding: 0 16px;
	font-size: 13px;
}
</style>
