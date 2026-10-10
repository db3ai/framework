<script setup lang="ts">
/** Project initials with a health dot. */
const props = defineProps<{ initials: string; health: 'ok' | 'bad' | 'off' }>();
</script>

<template>
	<span class="badge" aria-hidden="true">
		{{ props.initials }}
		<span class="health" :class="`health--${props.health}`" />
	</span>
</template>

<style scoped>
.badge {
	position: relative;
	width: 28px;
	height: 28px;
	flex: none;
	border-radius: 7px;
	background: var(--raised-hi);
	color: var(--text);
	font-size: 12px;
	font-weight: 600;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}

.health {
	position: absolute;
	right: -2px;
	bottom: -2px;
	width: 9px;
	height: 9px;
	border-radius: 50%;
	border: 2px solid var(--rail);
	background: var(--faint);
}

.health--ok {
	background: var(--ok);
}

.health--bad {
	background: var(--bad);
}
</style>
