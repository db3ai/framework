<script setup lang="ts">
import { DomIconButton, useTheme } from '@getdom/studio/vue';
import { Moon, Sun } from '@lucide/vue';
import { computed } from 'vue';

const { resolvedTheme, setMode } = useTheme();
const lightModeActive = computed(isLightModeActive);
const darkModeActive = computed(isDarkModeActive);

/**
 * Reports whether the resolved documentation theme is light.
 *
 * @returns True when light mode is active.
 */
function isLightModeActive(): boolean {
	return resolvedTheme.value === 'light';
}

/**
 * Reports whether the resolved documentation theme is dark.
 *
 * @returns True when dark mode is active.
 */
function isDarkModeActive(): boolean {
	return resolvedTheme.value === 'dark';
}

/**
 * Applies an explicit documentation color theme.
 *
 * @param theme - Light or dark theme selected by the reader.
 */
function setTheme(theme: 'light' | 'dark'): void {
	setMode(theme);
}
</script>

<template>
	<div class="docs-theme-picker" role="group" aria-label="Documentation theme">
		<DomIconButton
			:active="lightModeActive"
			:icon="Sun"
			label="Use light mode"
			size="sm"
			variant="ghost"
			@click="setTheme('light')"
		/>
		<DomIconButton
			:active="darkModeActive"
			:icon="Moon"
			label="Use dark mode"
			size="sm"
			variant="ghost"
			@click="setTheme('dark')"
		/>
	</div>
</template>
