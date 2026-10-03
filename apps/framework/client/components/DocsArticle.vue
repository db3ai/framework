<script setup lang="ts">
import { ArrowLeft, ArrowRight } from '@lucide/vue';
import { computed } from 'vue';
import { articleSections, articleReferencePath } from '../articleContent';
import { docAreas, type DocArticle, type DocArticleNavigation, type DocCodeSample } from '../docs';
import { documentationPath } from '../siteRoutes';
import DocsCodeExample from './DocsCodeExample.vue';
import DocsInlineText from './DocsInlineText.vue';
import DocsSectionLinks from './DocsSectionLinks.vue';
import FrameworkVision from './FrameworkVision.vue';
import VerifiedExample from './VerifiedExample.vue';

const props = defineProps<{
	article: DocArticle;
	navigation: DocArticleNavigation;
}>();

const areaLabel = computed(() => docAreas.find(area => area.id === props.article.area)?.label ?? 'Docs');

/**
 * Finds a code sample referenced by a content section.
 *
 * @param id - Stable code sample identifier.
 * @returns Matching code sample, or null when the section has no sample.
 */
function findCodeSample(id?: string): DocCodeSample | null {
	if (!id) return null;

	return props.article.codeSamples?.find(sample => sample.id === id) ?? null;
}
</script>

<template>
	<article class="docs-article">
		<nav class="docs-breadcrumb" aria-label="Breadcrumb">
			<span>{{ areaLabel }}</span>
			<span aria-hidden="true">/</span>
			<span>{{ article.group }}</span>
			<span aria-hidden="true">/</span>
			<strong>{{ article.label }}</strong>
		</nav>

		<header class="docs-article-header">
			<h1>{{ article.title }}</h1>
			<p><DocsInlineText :text="article.summary" /></p>
		</header>

		<details class="mb-8 border-y border-border py-4 min-[1280px]:hidden" data-compact-contents>
			<summary class="cursor-pointer text-sm font-semibold text-canvas-fg">On this page</summary>
			<DocsSectionLinks :article="article" />
			<a class="mt-4 block text-sm text-primary underline underline-offset-4" :href="`${documentationPath(article.id)}.md`" target="_blank" rel="noreferrer">Read as Markdown</a>
		</details>

		<section v-if="article.steps?.length" class="guide-overview" aria-labelledby="guide-overview-title">
			<h2 id="guide-overview-title">In this guide</h2>
			<ol>
				<li v-for="(step, index) in article.steps" :key="step.title">
					<span>{{ index + 1 }}</span>
					<div>
						<strong>{{ step.title }}</strong>
						<p><DocsInlineText :text="step.description" /></p>
					</div>
				</li>
			</ol>
		</section>

		<div class="docs-content">
			<section v-for="section in articleSections(article)" :id="section.id" :key="section.id" class="docs-content-section">
				<component :is="section.level === 3 ? 'h3' : 'h2'">{{ section.title }}</component>
				<p v-for="paragraph in section.paragraphs" :key="paragraph"><DocsInlineText :text="paragraph" /></p>
				<FrameworkVision v-if="section.visual === 'framework-vision'" />
				<ul v-if="section.links?.length" class="my-4 space-y-2">
					<li v-for="link in section.links" :key="link.href ?? `${link.articleId}#${link.sectionId ?? ''}`">
						<a v-if="link.href" class="text-primary underline underline-offset-4" :href="link.href"><DocsInlineText :text="link.label" /></a>
						<a v-else class="text-primary underline underline-offset-4" :href="documentationPath(link.articleId!, link.sectionId)" data-docs-navigation><DocsInlineText :text="link.label" /></a>
					</li>
				</ul>

				<DocsCodeExample v-if="findCodeSample(section.codeSampleId)" :sample="findCodeSample(section.codeSampleId)!" />
			</section>
		</div>

		<p v-if="articleReferencePath(article)" class="my-8 text-sm text-muted-fg">
			<a :href="articleReferencePath(article)" class="text-primary underline underline-offset-4">Service reference (Markdown)</a>
			 contains additional package details and examples.
		</p>

		<VerifiedExample v-if="article.verifiedExample" :example="article.verifiedExample" />

		<nav class="docs-page-navigation" aria-label="Adjacent documentation pages">
			<a
				v-if="navigation.previous"
				class="docs-page-link"
				:href="documentationPath(navigation.previous.id)"
				data-docs-navigation
			>
				<ArrowLeft :size="18" aria-hidden="true" />
				<span>
					<small>Previous</small>
					<strong>{{ navigation.previous.label }}</strong>
				</span>
			</a>
			<span v-else />
			<a
				v-if="navigation.next"
				class="docs-page-link text-right"
				:href="documentationPath(navigation.next.id)"
				data-docs-navigation
			>
				<span>
					<small>Next</small>
					<strong>{{ navigation.next.label }}</strong>
				</span>
				<ArrowRight :size="18" aria-hidden="true" />
			</a>
		</nav>
	</article>
</template>
