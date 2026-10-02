<script setup lang="ts">
import { DomDropdown } from '@getdom/studio/vue';
import { Code2, Menu, Search } from '@lucide/vue';
import { frameworkNavigation, guideNavigation, mobileLandingNavigation, serviceNavigation } from '../landing';
import DocsThemeToggle from './DocsThemeToggle.vue';

const emit = defineEmits<{
	navigate: [target: string];
	openSearch: [];
}>();

/**
 * Opens the documentation destination selected from landing navigation.
 *
 * @param target - Stable documentation article identifier.
 */
function selectNavigation(target: string): void {
	emit('navigate', target);
}
</script>

<template>
	<header class="landing-header">
		<div class="flex min-w-0 items-center gap-3">
			<div class="landing-mobile-navigation">
				<DomDropdown
					:items="mobileLandingNavigation"
					:show-indicator="false"
					label="Browse framework"
					trigger-class="landing-icon-button"
					width="min-w-[17rem]"
					@select="selectNavigation"
				>
					<template #trigger>
						<Menu :size="19" aria-hidden="true" />
						<span class="sr-only">Browse framework</span>
					</template>
				</DomDropdown>
			</div>

			<a href="/framework" class="landing-wordmark" data-docs-navigation aria-label="db3.ai Framework homepage">
				<span>db3.ai</span>
				<strong>Framework</strong>
			</a>
		</div>

		<nav class="landing-navigation" aria-label="Framework">
			<a class="landing-navigation-link" href="https://db3.ai">Company</a>
			<DomDropdown
				:items="frameworkNavigation"
				label="Framework"
				trigger-class="landing-navigation-trigger"
				width="min-w-[14rem]"
				@select="selectNavigation"
			/>
			<DomDropdown
				:items="guideNavigation"
				label="Guides"
				trigger-class="landing-navigation-trigger"
				width="min-w-[17rem]"
				@select="selectNavigation"
			/>
			<DomDropdown
				:items="serviceNavigation"
				label="Services"
				trigger-class="landing-navigation-trigger"
				width="min-w-[17rem]"
				@select="selectNavigation"
			/>
			<a class="landing-navigation-link" href="/docs/api-reference" data-docs-navigation>API</a>
		</nav>

		<div class="landing-header-actions">
			<button class="landing-search-trigger" type="button" aria-label="Search documentation" @click="$emit('openSearch')">
				<Search :size="17" aria-hidden="true" />
				<span>Search the docs…</span>
				<kbd>⌘K</kbd>
			</button>
			<button class="landing-mobile-search" type="button" aria-label="Search documentation" @click="$emit('openSearch')">
				<Search :size="18" aria-hidden="true" />
			</button>
			<DocsThemeToggle />
			<span class="landing-action-divider" aria-hidden="true" />
			<a class="landing-github-link" href="/llms.txt">
				<Code2 :size="19" aria-hidden="true" />
				<span>AI docs</span>
			</a>
		</div>
	</header>
</template>
