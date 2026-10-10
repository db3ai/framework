<script setup lang="ts">
import { ref } from 'vue';

import { useDockContext } from '../dock/context.js';
import ModalDialog from './ModalDialog.vue';

/** Adds a project folder; Dock picks up its api/dev/web/queue/scheduler scripts. */
const emit = defineEmits<{ close: []; added: [id: string] }>();

const { dock } = useDockContext();
const path = ref('');
const name = ref('');
const busy = ref(false);

async function submit(): Promise<void> {
	if (!path.value.trim() || busy.value) return;
	busy.value = true;
	const project = await dock.addProject(path.value, name.value || undefined);
	busy.value = false;
	if (project) emit('added', project.id);
}
</script>

<template>
	<ModalDialog title="Add project" subtitle="A folder with a package.json" :width="560" @close="emit('close')">
		<form id="add-project" class="fields" @submit.prevent="submit">
			<label class="field">
				Folder
				<input v-model="path" class="mono" type="text" placeholder="~/Sites/scout" required autocomplete="off" spellcheck="false">
			</label>
			<label class="field">
				Name <span class="optional">(optional)</span>
				<input v-model="name" type="text" placeholder="Defaults to the folder name" autocomplete="off">
			</label>
			<p class="hint">Dock adds the project's <span class="mono">api</span>, <span class="mono">dev</span>, <span class="mono">web</span>, <span class="mono">queue</span> and <span class="mono">scheduler</span> scripts if it has them. Nothing starts until you press start.</p>
			<p v-if="dock.error.value" class="error" role="alert">{{ dock.error.value }}</p>
		</form>
		<template #footer>
			<span class="spacer" />
			<button type="button" class="btn" @click="emit('close')">Cancel</button>
			<button type="submit" form="add-project" class="btn btn--primary" :disabled="busy || !path.trim()">Add project</button>
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
