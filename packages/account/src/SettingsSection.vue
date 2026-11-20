<script setup lang="ts">
/**
 * One titled group on a settings page: a heading, optional actions beside it, then rows
 * (SettingsRow) divided by hairlines. No card around it; spacing separates sections.
 */
defineProps<{ title: string; description?: string }>();
</script>

<template>
	<section class="text-sm">
		<div class="flex flex-wrap items-center justify-between gap-3 pb-2">
			<div class="min-w-0">
				<h2 class="text-base font-semibold text-canvas-fg">{{ title }}</h2>
				<p v-if="description" class="mt-0.5 text-muted-fg">{{ description }}</p>
			</div>
			<div v-if="$slots.actions" class="flex shrink-0 flex-wrap gap-2"><slot name="actions" /></div>
		</div>
		<div class="divide-y divide-border"><slot /></div>
	</section>
</template>
