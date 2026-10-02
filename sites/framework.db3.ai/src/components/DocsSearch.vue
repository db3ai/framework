<script setup lang="ts">
import { DomCommandPalette } from '@getdom/studio/vue';
import { documentationCommands, findArticle, type DocArticle, type DocumentationCommand } from '../docs';

defineProps<{
	open: boolean;
}>();

const emit = defineEmits<{
	'update:open': [open: boolean];
	select: [article: DocArticle];
}>();

const commands = documentationCommands();

/**
 * Selection payload emitted by DOM Studio's command palette.
 */
interface CommandSelection {
	command: DocumentationCommand;
	value: string;
}

/**
 * Resolves and emits the article selected through the command palette.
 *
 * @param selection - DOM Studio command selection payload.
 */
function selectCommand(selection: CommandSelection): void {
	const article = findArticle(selection.value);

	if (article) emit('select', article);
}
</script>

<template>
	<DomCommandPalette
		:model-value="open"
		:commands="commands"
		placeholder="Search services, guides, packages…"
		shortcut="mod+k"
		@update:model-value="$emit('update:open', $event)"
		@select="selectCommand"
	/>
</template>
