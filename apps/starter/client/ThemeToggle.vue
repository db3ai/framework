<script setup lang="ts">
import { onMounted } from 'vue';
import { DomButton, useTheme } from '@getdom/studio/vue';

const { resolvedTheme, initTheme, setMode } = useTheme();
onMounted(initTheme);

/** Switches the public DOM Studio theme preference and persists it on this origin. */
function toggleTheme() { setMode(resolvedTheme.value === 'dark' ? 'light' : 'dark'); }
</script>

<template>
	<DomButton variant="ghost" size="sm" :aria-label="resolvedTheme === 'dark' ? 'Use light theme' : 'Use dark theme'" @click="toggleTheme">{{ resolvedTheme === 'dark' ? 'Light' : 'Dark' }}</DomButton>
</template>
