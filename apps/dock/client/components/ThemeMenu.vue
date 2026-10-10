<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';

import type { ThemePreference } from '../dock/useLayout.js';
import Icon from './Icon.vue';

/** Header menu to choose System, Light or Dark. */
const theme = defineModel<ThemePreference>({ required: true });

const options: Array<{ value: ThemePreference; label: string; icon: 'monitor' | 'sun' | 'moon' }> = [
	{ value: 'system', label: 'System', icon: 'monitor' },
	{ value: 'light', label: 'Light', icon: 'sun' },
	{ value: 'dark', label: 'Dark', icon: 'moon' },
];

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const current = computed(() => options.find(option => option.value === theme.value) ?? options[0]!);

async function toggle(): Promise<void> {
	if (open.value) {
		close();
		return;
	}
	open.value = true;
	document.addEventListener('pointerdown', onOutside);
	await nextTick();
	menu.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
}

function close(): void {
	open.value = false;
	document.removeEventListener('pointerdown', onOutside);
}

function onOutside(event: PointerEvent): void {
	if (root.value && !root.value.contains(event.target as Node)) close();
}

function choose(value: ThemePreference): void {
	theme.value = value;
	close();
	root.value?.querySelector<HTMLElement>('.trigger')?.focus();
}

function onKey(event: KeyboardEvent): void {
	const items = [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
	const index = items.indexOf(document.activeElement as HTMLElement);
	if (event.key === 'Escape') {
		close();
		root.value?.querySelector<HTMLElement>('.trigger')?.focus();
	} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault();
		items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
	}
}

onBeforeUnmount(close);
</script>

<template>
	<div ref="root" class="theme">
		<button
			type="button"
			class="icon-btn trigger"
			:aria-label="`Theme: ${current.label}`"
			:title="`Theme: ${current.label}`"
			aria-haspopup="menu"
			:aria-expanded="open"
			@click="toggle"
		><Icon :name="current.icon" :size="16" /></button>
		<div v-if="open" ref="menu" class="menu" role="menu" aria-label="Theme" @keydown="onKey">
			<button
				v-for="option in options"
				:key="option.value"
				type="button"
				role="menuitemradio"
				class="item"
				:aria-checked="theme === option.value"
				@click="choose(option.value)"
			>
				<Icon :name="option.icon" :size="15" />
				<span class="label">{{ option.label }}</span>
				<span class="check"><Icon v-if="theme === option.value" name="check" :size="14" /></span>
			</button>
		</div>
	</div>
</template>

<style scoped>
.theme {
	position: relative;
}

.trigger {
	width: 36px;
	height: 36px;
}

.menu {
	position: absolute;
	top: 42px;
	right: 0;
	z-index: 30;
	width: 180px;
	padding: 6px;
	border-radius: 10px;
	border: 1px solid var(--line-strong);
	background: var(--menu);
	box-shadow: 0 16px 40px var(--shadow);
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.item {
	display: flex;
	align-items: center;
	gap: 10px;
	height: 40px;
	padding: 0 10px;
	border: 0;
	border-radius: 7px;
	background: transparent;
	color: var(--text);
	font-size: 13px;
	text-align: left;
}

.item:hover,
.item:focus-visible,
.item[aria-checked='true'] {
	background: var(--raised-hi);
}

.label {
	flex: 1;
}

.check {
	width: 16px;
	display: flex;
	justify-content: center;
	color: var(--link);
}
</style>
