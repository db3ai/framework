<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';

import type { ProjectNavItem } from '../dock/projectNav.js';
import Icon from './Icon.vue';
import ProjectBadge from './ProjectBadge.vue';

/** Current project in the header, opening a menu to switch project or add one. */
const props = defineProps<{ items: ProjectNavItem[]; current: string; subtitle: string }>();
const emit = defineEmits<{ pick: [id: string]; addProject: [] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const currentItem = computed(() => props.items.find(item => item.id === props.current) ?? props.items[0]);

async function toggle(): Promise<void> {
	open.value = !open.value;
	if (open.value) {
		document.addEventListener('pointerdown', onOutside);
		await nextTick();
		menu.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
	} else {
		close();
	}
}

function close(): void {
	open.value = false;
	document.removeEventListener('pointerdown', onOutside);
}

function onOutside(event: PointerEvent): void {
	if (root.value && !root.value.contains(event.target as Node)) close();
}

function choose(id: string): void {
	emit('pick', id);
	close();
}

function onMenuKey(event: KeyboardEvent): void {
	const items = [...(menu.value?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
	const index = items.indexOf(document.activeElement as HTMLElement);
	if (event.key === 'Escape') {
		close();
		root.value?.querySelector<HTMLElement>('.trigger')?.focus();
	} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault();
		const step = event.key === 'ArrowDown' ? 1 : -1;
		items[(index + step + items.length) % items.length]?.focus();
	}
}

onBeforeUnmount(close);
</script>

<template>
	<div ref="root" class="switcher">
		<button type="button" class="trigger" :class="{ 'trigger--open': open }" aria-haspopup="menu" :aria-expanded="open" @click="toggle">
			<ProjectBadge v-if="currentItem" :initials="currentItem.initials" :health="currentItem.health" />
			<span class="text">
				<span class="label">{{ currentItem?.label ?? 'Dock' }}</span>
				<span class="sub">{{ props.subtitle }}</span>
			</span>
			<Icon name="chevron" :size="14" />
		</button>
		<div v-if="open" ref="menu" class="menu" role="menu" aria-label="Switch project" @keydown="onMenuKey">
			<button
				v-for="item in props.items"
				:key="item.id"
				type="button"
				role="menuitemradio"
				class="menu-item"
				:aria-checked="item.id === props.current"
				@click="choose(item.id)"
			>
				<ProjectBadge :initials="item.initials" :health="item.health" />
				<span class="menu-label">{{ item.label }}</span>
				<span class="count mono">{{ item.running }}/{{ item.total }}</span>
				<span class="check"><Icon v-if="item.id === props.current" name="check" :size="14" /></span>
			</button>
			<div class="divider" role="separator" />
			<button type="button" role="menuitem" class="menu-item" @click="close(); emit('addProject')">
				<span class="plus"><Icon name="plus" :size="14" /></span>
				<span class="menu-label">Add project…</span>
			</button>
		</div>
	</div>
</template>

<style scoped>
.switcher {
	position: relative;
}

.trigger {
	height: 44px;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 0 10px 0 6px;
	border-radius: 9px;
	border: 1px solid transparent;
	background: transparent;
	text-align: left;
	color: var(--muted);
}

.trigger:hover,
.trigger--open {
	background: var(--raised);
	border-color: var(--line-strong);
}

.text {
	display: flex;
	flex-direction: column;
	line-height: 1.2;
	min-width: 0;
}

.label {
	font-weight: 600;
	font-size: 15px;
	color: var(--text);
	white-space: nowrap;
}

.sub {
	font-size: 12px;
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 320px;
}

.menu {
	position: absolute;
	top: 50px;
	left: 0;
	z-index: 30;
	width: 300px;
	background: var(--menu);
	border: 1px solid var(--line-strong);
	border-radius: 10px;
	padding: 6px;
	box-shadow: 0 16px 40px var(--shadow);
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.menu-item {
	display: flex;
	align-items: center;
	gap: 10px;
	height: 44px;
	padding: 0 8px;
	border-radius: 7px;
	border: 0;
	background: transparent;
	font-size: 13px;
	text-align: left;
}

.menu-item:hover,
.menu-item:focus-visible,
.menu-item[aria-checked='true'] {
	background: var(--raised-hi);
}

.menu-label {
	flex: 1;
}

.count {
	font-size: 12px;
	color: var(--muted);
}

.check {
	width: 16px;
	color: var(--link);
	display: flex;
	justify-content: center;
}

.plus {
	width: 28px;
	display: flex;
	justify-content: center;
	color: var(--text-2);
}

.divider {
	height: 1px;
	background: var(--line);
	margin: 4px 2px;
}
</style>
