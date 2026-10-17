<script setup lang="ts">
import { ref } from 'vue';

import { useDockContext } from '../../dock/context.js';
import ModalDialog from '../ModalDialog.vue';

/** Adds a Docker host, reached over SSH (or this machine when left empty). */
const emit = defineEmits<{ close: []; added: [id: string] }>();

const { dock } = useDockContext();
const ssh = ref('');
const name = ref('');
const busy = ref(false);

async function submit(): Promise<void> {
	if (busy.value) return;
	busy.value = true;
	const host = await dock.addHost({ name: name.value, ssh: ssh.value || undefined });
	busy.value = false;
	if (host) emit('added', host.id);
}
</script>

<template>
	<ModalDialog title="Add server" subtitle="A machine running Docker" :width="560" @close="emit('close')">
		<form id="add-host" class="fields" @submit.prevent="submit">
			<label class="field">
				SSH destination
				<input v-model="ssh" class="mono" type="text" placeholder="steve@mac-server" autocomplete="off" spellcheck="false">
			</label>
			<label class="field">
				Name <span class="optional">(optional)</span>
				<input v-model="name" type="text" placeholder="Defaults to the host name" autocomplete="off">
			</label>
			<p class="hint">Dock connects with your existing SSH keys and never prompts, so <span class="mono">ssh steve@mac-server</span> must already work without a password. Nothing is installed on the server. Leave the destination empty to watch Docker on this machine.</p>
			<p v-if="dock.error.value" class="error" role="alert">{{ dock.error.value }}</p>
		</form>
		<template #footer>
			<span class="spacer" />
			<button type="button" class="btn" @click="emit('close')">Cancel</button>
			<button type="submit" form="add-host" class="btn btn--primary" :disabled="busy">Add server</button>
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
