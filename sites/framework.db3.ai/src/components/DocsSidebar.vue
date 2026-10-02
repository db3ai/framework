<script setup lang="ts">
import { DomDropdown } from '@getdom/studio/vue';
import { ChevronRight, Package, X } from '@lucide/vue';
import { computed } from 'vue';
import type { DocArticle, DocNavigationGroup } from '../docs';
import { documentationPath } from '../siteRoutes';

const props = defineProps<{
	activeArticleId: string;
	activePackage: string;
	groups: DocNavigationGroup[];
	open: boolean;
}>();

const emit = defineEmits<{
	close: [];
	selectPackage: [packageName: string];
}>();

const basePackages = ['@db3.ai/app', '@db3.ai/pure'];
const packageOptions = computed(getPackageOptions);
const packageItems = computed(getPackageItems);

/**
 * Includes the current service module alongside the framework package list.
 *
 * @returns Package names available from the contextual selector.
 */
function getPackageOptions(): string[] {
	return Array.from(new Set([props.activePackage, ...basePackages]));
}

/**
 * Builds DOM Studio dropdown items from the available package names.
 *
 * @returns Label and value records for the package dropdown.
 */
function getPackageItems(): Array<{ label: string; value: string }> {
	return packageOptions.value.map(packageName => ({
		label: packageName,
		value: packageName,
	}));
}

/**
 * Emits the package selected through the DOM Studio dropdown.
 *
 * @param packageName - Package selected by the reader.
 */
function selectPackage(packageName: string): void {
	emit('selectPackage', packageName);
}
</script>

<template>
	<div
		v-if="open"
		class="fixed inset-0 z-30 bg-canvas-fg/25 backdrop-blur-[2px] lg:hidden"
		aria-hidden="true"
		@click="$emit('close')"
	/>

	<aside class="docs-sidebar" :class="{ 'is-open': open }">
		<div class="mb-5 flex items-center justify-between lg:hidden">
			<strong class="text-sm">Documentation</strong>
			<button class="docs-icon-button" type="button" aria-label="Close documentation navigation" @click="$emit('close')">
				<X :size="18" aria-hidden="true" />
			</button>
		</div>

		<div class="mb-6">
			<span class="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-muted-fg uppercase">
				<Package :size="13" aria-hidden="true" />
				Package
			</span>
			<DomDropdown
				:items="packageItems"
				:label="activePackage"
				:focus-value="activePackage"
				trigger-class="docs-select w-full justify-between"
				width="min-w-[14rem]"
				@select="selectPackage"
			/>
		</div>

		<nav class="space-y-5" aria-label="Current documentation section">
			<section v-for="group in groups" :key="group.title">
				<h2 class="docs-sidebar-heading">{{ group.title }}</h2>
				<div class="mt-1 space-y-0.5">
					<a
						v-for="article in group.articles"
						:key="article.id"
						class="docs-sidebar-link"
						:class="{ 'is-active': activeArticleId === article.id }"
						:href="documentationPath(article.id)"
						data-docs-navigation
						:aria-current="activeArticleId === article.id ? 'page' : undefined"
					>
						<span>{{ article.label }}</span>
						<ChevronRight :size="14" aria-hidden="true" />
					</a>
				</div>
			</section>
		</nav>
	</aside>
</template>
