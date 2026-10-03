<script setup lang="ts">
import { ExternalLink, FileCode2, Package } from '@lucide/vue';
import type { DocArticle } from '../docs';
import { documentationPath } from '../siteRoutes';
import DocsSectionLinks from './DocsSectionLinks.vue';

defineProps<{
	article: DocArticle;
	relatedArticles: DocArticle[];
}>();

/**
 * Presents repository paths relative to their owning package when possible.
 *
 * @param sourcePath - Full repository-relative source path.
 * @returns Compact source label for the context rail.
 */
function displaySourcePath(sourcePath: string): string {
	return sourcePath.replace(/^packages\/[^/]+\//, '');
}
</script>

<template>
	<aside class="docs-context-rail">
		<section>
			<h2>On this page</h2>
			<DocsSectionLinks :article="article" />
		</section>

		<section>
			<h2>Package</h2>
			<a class="context-link is-primary" :href="documentationPath(article.id)" data-docs-navigation>
				<Package :size="16" aria-hidden="true" />
				{{ article.packageName }}
			</a>
		</section>

		<section>
			<h2>Page formats</h2>
			<a
				class="context-link is-primary"
				:href="`${documentationPath(article.id)}.md`"
				target="_blank"
				rel="noreferrer"
			>
				<FileCode2 :size="16" aria-hidden="true" />
				<span>Read as Markdown</span>
				<ExternalLink :size="13" aria-hidden="true" />
			</a>
			<p class="mt-3 break-words text-xs text-muted-fg">{{ displaySourcePath(article.sourcePath) }}</p>
		</section>

		<section v-if="relatedArticles.length">
			<h2>Related guides</h2>
			<ul class="mt-4 space-y-2.5">
				<li v-for="related in relatedArticles" :key="related.id">
					<a :href="documentationPath(related.id)" data-docs-navigation>{{ related.label }}</a>
				</li>
			</ul>
		</section>

	</aside>
</template>
