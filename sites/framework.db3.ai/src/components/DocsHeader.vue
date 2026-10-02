<script setup lang="ts">
import { Code2, Menu, Search } from '@lucide/vue';
import { frameworkPackageMetadata } from '../generated/framework-metadata';
import DocsThemeToggle from './DocsThemeToggle.vue';

defineEmits<{
	openNavigation: [];
	openSearch: [];
}>();

const versionLabel = `v${frameworkPackageMetadata.version}`;
</script>

<template>
	<header class="docs-header">
		<div class="flex min-w-0 items-center gap-3">
			<button
				class="docs-icon-button docs-mobile-menu"
				type="button"
				aria-label="Open documentation navigation"
				@click="$emit('openNavigation')"
			>
				<Menu :size="18" aria-hidden="true" />
			</button>
			<a href="/framework" class="docs-wordmark" data-docs-navigation aria-label="db3.ai Framework homepage">
				<span>db3.ai</span>
				<strong>Framework</strong>
			</a>
			<div class="hidden sm:block">
				<span class="docs-select inline-flex min-w-24 items-center" aria-label="Framework package version">
					{{ versionLabel }}
				</span>
			</div>
		</div>

		<button
			class="docs-search-trigger"
			type="button"
			aria-label="Search documentation"
			@click="$emit('openSearch')"
		>
			<Search :size="17" aria-hidden="true" />
			<span>Search the docs…</span>
			<kbd>⌘K</kbd>
		</button>

		<div class="flex items-center justify-end gap-2">
			<button
				class="docs-icon-button docs-mobile-search"
				type="button"
				aria-label="Search documentation"
				@click="$emit('openSearch')"
			>
				<Search :size="17" aria-hidden="true" />
			</button>
			<DocsThemeToggle />
			<span class="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
			<a
				class="docs-header-link"
				href="/llms.txt"
			>
				<Code2 :size="17" aria-hidden="true" />
				<span class="hidden md:inline">AI docs</span>
			</a>
		</div>
	</header>
</template>
