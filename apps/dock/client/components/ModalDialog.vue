<script setup lang="ts">
import { onMounted, ref } from 'vue';

import Icon from './Icon.vue';

/** Native modal dialog shell: focus trapping, Escape and backdrop come from `<dialog>`. */
const props = withDefaults(defineProps<{ title: string; subtitle?: string; width?: number }>(), { width: 640 });
const emit = defineEmits<{ close: [] }>();

const element = ref<HTMLDialogElement | null>(null);

onMounted(() => element.value?.showModal());

function onBackdrop(event: MouseEvent): void {
	if (event.target === element.value) emit('close');
}
</script>

<template>
	<dialog ref="element" class="modal" :style="{ width: `min(${props.width}px, calc(100vw - 32px))` }" aria-labelledby="modal-title" @cancel.prevent="emit('close')" @click="onBackdrop">
		<header class="head">
			<div class="titles">
				<h1 id="modal-title">{{ props.title }}</h1>
				<span v-if="props.subtitle" class="sub mono">{{ props.subtitle }}</span>
			</div>
			<button type="button" class="icon-btn icon-btn--ghost close" aria-label="Close" @click="emit('close')"><Icon name="close" /></button>
		</header>
		<div class="body"><slot /></div>
		<footer class="foot"><slot name="footer" /></footer>
	</dialog>
</template>

<style scoped>
.modal {
	padding: 0;
	max-height: calc(100vh - 48px);
	border: 1px solid var(--line-strong);
	border-radius: 14px;
	background: var(--panel);
	color: var(--text);
	box-shadow: 0 24px 60px var(--shadow);
	flex-direction: column;
}

.modal[open] {
	display: flex;
}

.modal::backdrop {
	background: var(--backdrop);
}

.head {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 16px 20px;
	border-bottom: 1px solid var(--line);
}

.titles {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

h1 {
	margin: 0;
	font-size: 17px;
	font-weight: 600;
}

.sub {
	font-size: 12px;
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.close {
	width: 36px;
	height: 36px;
}

.body {
	flex: 1;
	min-height: 0;
	overflow: auto;
	padding: 20px;
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	padding: 14px 20px;
	border-top: 1px solid var(--line);
	background: var(--bar);
}
</style>
