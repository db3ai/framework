<script setup lang="ts">
/**
 * A label on the left and its control on the right, like "Full name  [Steve]". The description
 * sits under the label. On a phone the control drops under the label. Anything placed in the
 * `details` slot (a form that opens from the control) spans the full row below.
 */
defineProps<{ label: string; description?: string }>();
</script>

<template>
	<div class="py-4">
		<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
			<div class="min-w-0 flex-[1_1_14rem]">
				<p class="text-canvas-fg">{{ label }}</p>
				<p v-if="description || $slots.description" class="mt-0.5 text-muted-fg"><slot name="description">{{ description }}</slot></p>
			</div>
			<div class="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2"><slot /></div>
		</div>
		<div v-if="$slots.details" class="mt-4"><slot name="details" /></div>
	</div>
</template>
