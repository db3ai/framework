<script setup lang="ts">
import type { Component } from 'vue';

/** One link in the settings navigation. `icon` is any Vue component, such as a Lucide icon. */
export interface SettingsNavItem { id: string; name: string; href: string; icon?: Component }

/**
 * The settings page's left navigation: groups of icon + name links divided by hairlines, the
 * open one filled. Links are real addresses, so they open in new tabs and survive reloads; a
 * plain click emits `select` for the host's router.
 */
defineProps<{ groups: Array<{ label?: string; items: SettingsNavItem[] }>; current: string }>();
defineEmits<{ select: [id: string] }>();
</script>

<template>
	<nav aria-label="Settings" class="flex flex-col text-sm">
		<div v-for="(group, index) in groups" :key="group.label ?? index" class="flex flex-col gap-0.5" :class="index ? 'mt-3 border-t border-border pt-3' : ''">
			<p v-if="group.label" class="truncate px-3 pb-1 text-xs text-muted-fg">{{ group.label }}</p>
			<a v-for="item in group.items" :key="item.id" :href="item.href" class="flex min-h-9 items-center gap-3 rounded-lg px-3" :class="current === item.id ? 'bg-muted font-medium text-canvas-fg' : 'text-muted-fg hover:bg-muted/60 hover:text-canvas-fg'" :aria-current="current === item.id ? 'page' : undefined" :data-settings-tab="item.id" @click.exact.prevent="$emit('select', item.id)">
				<component :is="item.icon" v-if="item.icon" class="size-4 shrink-0" aria-hidden="true" />
				<span class="truncate">{{ item.name }}</span>
			</a>
		</div>
	</nav>
</template>
