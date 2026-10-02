<script setup lang="ts">
import { Bot, Box, Braces, BookOpen, ChefHat, CodeXml, House } from '@lucide/vue';
import type { Component } from 'vue';
import { docAreas, docArticles, type DocAreaId } from '../docs';
import { documentationPath } from '../siteRoutes';

defineProps<{
	activeArea: DocAreaId;
}>();

const areaIcons: Record<DocAreaId, Component> = {
	start: House,
	ai: Bot,
	guides: BookOpen,
	services: Box,
	cookbook: ChefHat,
	examples: CodeXml,
	api: Braces,
};

/**
 * Resolves the first canonical article path for a documentation area.
 *
 * @param area - Global documentation area selected by the reader.
 * @returns Canonical first-article path, falling back to the homepage.
 */
function areaPath(area: DocAreaId): string {
	const article = docArticles.find(candidate => candidate.area === area);

	return article ? documentationPath(article.id) : '/';
}
</script>

<template>
	<nav class="docs-global-rail" aria-label="Documentation areas">
		<a
			v-for="area in docAreas"
			:key="area.id"
			class="docs-rail-link"
			:class="{ 'is-active': activeArea === area.id }"
			:href="areaPath(area.id)"
			data-docs-navigation
			:title="area.description"
			:aria-current="activeArea === area.id ? 'page' : undefined"
		>
			<component :is="areaIcons[area.id]" :size="23" :stroke-width="1.65" aria-hidden="true" />
			<span>{{ area.label }}</span>
		</a>
	</nav>
</template>
