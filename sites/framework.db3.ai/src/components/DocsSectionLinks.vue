<script setup lang="ts">
import type { DocArticle } from '../docs';
import { articleSections } from '../articleContent';
import { documentationPath } from '../siteRoutes';

defineProps<{ article: DocArticle }>();
</script>

<template>
	<nav class="mt-4 space-y-3" aria-label="Article sections">
		<a v-for="section in articleSections(article)" :key="section.id" :class="{ 'is-subsection border-l border-border pl-3': section.level === 3 }" class="block text-xs leading-5 text-muted-fg hover:text-primary" :href="documentationPath(article.id, section.id)" data-docs-navigation>{{ section.title }}</a>
		<a v-if="article.verifiedExample" class="block text-xs leading-5 text-muted-fg hover:text-primary" :href="documentationPath(article.id, 'verified-example')" data-docs-navigation>Verified example</a>
	</nav>
</template>
