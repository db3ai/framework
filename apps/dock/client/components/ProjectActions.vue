<script setup lang="ts">
import type { ProjectDefinition } from '../../shared/contracts.js';
import { useDockContext } from '../dock/context.js';
import Icon from './Icon.vue';

/** Buttons shared by a project's header in both views. */
const props = withDefaults(defineProps<{ project: ProjectDefinition; showTerminals?: boolean }>(), { showTerminals: false });

const { dock, layout, openAddProcess } = useDockContext();

function showTerminals(): void {
	layout.view = 'terminals';
	layout.project = props.project.id;
}

function removeProject(): void {
	if (window.confirm(`Stop all of ${props.project.name}'s processes and remove the project from Dock? Files are not touched.`)) {
		void dock.removeProject(props.project.id);
	}
}
</script>

<template>
	<div class="actions">
		<button type="button" class="btn" @click="openAddProcess(props.project.id)"><Icon name="plus" :size="13" /> Add process</button>
		<button v-if="props.showTerminals" type="button" class="btn" @click="showTerminals"><Icon name="grid" :size="13" /> All terminals</button>
		<button type="button" class="btn" @click="dock.projectAction(props.project.id, 'open-editor')"><Icon name="code" :size="13" /> Open in editor</button>
		<button type="button" class="btn" @click="dock.projectAction(props.project.id, 'start')"><Icon name="play" :size="11" /> Start all</button>
		<button type="button" class="btn" @click="dock.projectAction(props.project.id, 'restart')"><Icon name="restart" :size="13" /> Restart all</button>
		<button type="button" class="btn" @click="dock.projectAction(props.project.id, 'stop')"><Icon name="stop" :size="11" /> Stop all</button>
		<button type="button" class="btn" :aria-label="`Remove project ${props.project.name}`" title="Remove project" @click="removeProject"><Icon name="trash" :size="13" /></button>
	</div>
</template>

<style scoped>
.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
</style>
