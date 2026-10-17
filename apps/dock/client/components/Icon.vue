<script lang="ts">
/** Names accepted by {@link Icon}. */
export type IconName =
	| 'api' | 'web' | 'queue' | 'scheduler' | 'script'
	| 'restart' | 'stop' | 'play' | 'terminal' | 'code' | 'plus' | 'search' | 'sidebar'
	| 'list' | 'grid' | 'chevron' | 'check' | 'close' | 'maximize' | 'minimize' | 'external' | 'trash' | 'clear'
	| 'sun' | 'moon' | 'monitor'
	| 'route' | 'cloud' | 'database' | 'archive' | 'server' | 'alert' | 'branch';
</script>

<script setup lang="ts">
/** Stroke icons used across Dock. Decorative: give the parent control an accessible name. */
const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 16 });

const filled = new Set<IconName>(['stop', 'play']);
</script>

<template>
	<svg
		:width="props.size"
		:height="props.size"
		viewBox="0 0 24 24"
		:fill="filled.has(props.name) ? 'currentColor' : 'none'"
		:stroke="filled.has(props.name) ? 'none' : 'currentColor'"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		focusable="false"
	>
		<template v-if="props.name === 'api'"><path d="M8 4c-2 0-2 2-2 4s-1 3-2 4c1 1 2 2 2 4s0 4 2 4" /><path d="M16 4c2 0 2 2 2 4s1 3 2 4c-1 1-2 2-2 4s0 4-2 4" /></template>
		<template v-else-if="props.name === 'web'"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></template>
		<template v-else-if="props.name === 'queue'"><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></template>
		<template v-else-if="props.name === 'scheduler'"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></template>
		<template v-else-if="props.name === 'script' || props.name === 'terminal'"><path d="M4 6l6 6-6 6" /><path d="M12 18h8" /></template>
		<template v-else-if="props.name === 'restart'"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></template>
		<template v-else-if="props.name === 'stop'"><rect x="6" y="6" width="12" height="12" rx="2" /></template>
		<template v-else-if="props.name === 'play'"><path d="M7 5l12 7-12 7z" /></template>
		<template v-else-if="props.name === 'code'"><path d="M9 8l-5 4 5 4M15 8l5 4-5 4" /></template>
		<template v-else-if="props.name === 'plus'"><path d="M12 5v14M5 12h14" /></template>
		<template v-else-if="props.name === 'search'"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></template>
		<template v-else-if="props.name === 'sidebar'"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></template>
		<template v-else-if="props.name === 'list'"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></template>
		<template v-else-if="props.name === 'grid'"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></template>
		<template v-else-if="props.name === 'chevron'"><path d="M6 9l6 6 6-6" /></template>
		<template v-else-if="props.name === 'check'"><path d="M5 12l5 5 9-10" /></template>
		<template v-else-if="props.name === 'close'"><path d="M6 6l12 12M18 6L6 18" /></template>
		<template v-else-if="props.name === 'maximize'"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></template>
		<template v-else-if="props.name === 'minimize'"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></template>
		<template v-else-if="props.name === 'external'"><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></template>
		<template v-else-if="props.name === 'trash'"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></template>
		<template v-else-if="props.name === 'sun'"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></template>
		<template v-else-if="props.name === 'moon'"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></template>
		<template v-else-if="props.name === 'monitor'"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></template>
		<template v-else-if="props.name === 'branch'"><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10" /><path d="M18 9a6 6 0 0 1-6 6H6" /></template>
		<template v-else-if="props.name === 'route'"><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="12" r="2.5" /><path d="M8.5 6h2a3 3 0 0 1 3 3v0a3 3 0 0 0 2 2.8M8.5 18h2a3 3 0 0 0 3-3v0a3 3 0 0 1 2-2.8" /></template>
		<template v-else-if="props.name === 'cloud'"><path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18z" /></template>
		<template v-else-if="props.name === 'database'"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" /><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" /></template>
		<template v-else-if="props.name === 'archive'"><rect x="3" y="4" width="18" height="4.5" rx="1" /><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4" /></template>
		<template v-else-if="props.name === 'server'"><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></template>
		<template v-else-if="props.name === 'alert'"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></template>
		<template v-else-if="props.name === 'clear'"><path d="M4 20h16" /><path d="M7 16l9-9 3 3-9 9H7z" /></template>
	</svg>
</template>
