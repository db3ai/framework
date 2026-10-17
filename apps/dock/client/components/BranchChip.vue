<script setup lang="ts">
import { computed } from 'vue';

import { useDockContext } from '../dock/context.js';
import Icon from './Icon.vue';

/** The git branch a project folder has checked out. Renders nothing outside a git repository. */
const props = defineProps<{ projectId: string }>();

const { dock } = useDockContext();
const branch = computed(() => dock.branchOf(props.projectId));
const title = computed(() => (branch.value?.detached ? `Detached HEAD at ${branch.value.name}` : `On branch ${branch.value?.name}`));
</script>

<template>
	<span v-if="branch" class="branch mono" :class="{ 'branch--detached': branch.detached }" :title="title">
		<Icon name="branch" :size="12" />
		<span class="name">{{ branch.name }}</span>
		<span class="visually-hidden">{{ branch.detached ? '(detached)' : '(git branch)' }}</span>
	</span>
</template>

<style scoped>
.branch {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	min-width: 0;
	max-width: 260px;
	padding: 2px 8px;
	border: 1px solid var(--line);
	border-radius: 999px;
	background: var(--raised);
	color: var(--text-2);
	font-size: 12px;
	line-height: 1.4;
	/* Gives way to the project name, then truncates. */
	flex: 0 1 auto;
	align-self: center;
}

.branch--detached {
	color: var(--warn);
}

.branch svg {
	flex: none;
}

.name {
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
</style>
