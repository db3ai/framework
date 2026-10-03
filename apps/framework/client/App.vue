<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import DocsArticle from './components/DocsArticle.vue';
import DocsHeader from './components/DocsHeader.vue';
import DocsOnThisPage from './components/DocsOnThisPage.vue';
import DocsSearch from './components/DocsSearch.vue';
import DocsSidebar from './components/DocsSidebar.vue';
import GlobalDocsRail from './components/GlobalDocsRail.vue';
import LandingHeader from './components/LandingHeader.vue';
import LandingPage from './components/LandingPage.vue';
import { articleNavigation, docArticles, findArticle, navigationGroups, type DocArticle } from './docs';
import { documentationPageMetadata, type DocumentationPageKind } from './pageMetadata';
import { browserDocumentationLocation, documentationPath, LANDING_PATH, parseDocumentationRoute } from './siteRoutes';

const props = defineProps<{
	initialLocation: string;
}>();

const DEFAULT_ARTICLE_ID = 'queue-overview';
const initialRoute = parseDocumentationRoute(props.initialLocation);
const routeArticle = initialRoute.kind === 'article' ? findArticle(initialRoute.articleId) : null;
const initialArticle = routeArticle ?? findArticle(DEFAULT_ARTICLE_ID) ?? docArticles[0];

const activeArticle = ref<DocArticle>(initialArticle);
const activePackage = ref(initialArticle.packageName);
const landingOpen = ref(initialRoute.kind === 'landing');
const notFound = ref(initialRoute.kind === 'not-found' || (initialRoute.kind === 'article' && !routeArticle));
const searchOpen = ref(false);
const navigationOpen = ref(false);

const activeArea = computed(() => activeArticle.value.area);
const groups = computed(() => navigationGroups(
	activeArea.value,
	activeArea.value === 'api' ? activePackage.value : undefined,
));
const adjacentArticles = computed(() => articleNavigation(activeArticle.value));
const relatedArticles = computed(() => (activeArticle.value.relatedIds ?? [])
	.map(id => findArticle(id))
	.filter((article): article is DocArticle => Boolean(article)));

/**
 * Makes one article current through the canonical browser history path.
 *
 * @param article - Documentation article selected by the reader.
 */
function selectArticle(article: DocArticle): void {
	navigateToLocation(documentationPath(article.id));
}

/**
 * Opens a landing-page destination by its stable article identifier.
 *
 * @param target - Landing page path or documentation article identifier.
 */
function navigateTo(target: string): void {
	if (target === LANDING_PATH) {
		navigateToLocation(LANDING_PATH);
		return;
	}

	const article = findArticle(target);

	if (article) selectArticle(article);
}

/**
 * Opens the first documentation entry owned by the selected package.
 *
 * @param packageName - Package selected from contextual navigation.
 */
function selectPackage(packageName: string): void {
	activePackage.value = packageName;
	const article = docArticles.find(candidate => candidate.packageName === packageName);

	if (article) selectArticle(article);
}

/**
 * Opens the command-search surface.
 */
function openSearch(): void {
	searchOpen.value = true;
}

/**
 * Closes the mobile navigation surface.
 */
function closeNavigation(): void {
	navigationOpen.value = false;
}

/**
 * Closes mobile navigation when the reader presses Escape.
 *
 * @param event - Browser keyboard event.
 */
function handleKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape') navigationOpen.value = false;
}

/**
 * Intercepts ordinary same-origin documentation anchors for client navigation.
 *
 * Modified clicks retain native browser behaviour so readers can open a page
 * in a new tab, while JavaScript-free clients can always follow the real href.
 *
 * @param event - Document-level browser click event.
 */
function handleDocumentClick(event: MouseEvent): void {
	if (
		event.defaultPrevented
		|| event.button !== 0
		|| event.metaKey
		|| event.ctrlKey
		|| event.shiftKey
		|| event.altKey
	) return;

	const target = event.target;
	const anchor = target instanceof Element
		? target.closest<HTMLAnchorElement>('a[data-docs-navigation]')
		: null;

	if (!anchor || anchor.target || anchor.hasAttribute('download')) return;

	const url = new URL(anchor.href, window.location.href);

	if (url.origin !== window.location.origin || parseDocumentationRoute(url.href).kind === 'not-found') return;

	event.preventDefault();
	navigateToLocation(`${url.pathname}${url.search}${url.hash}`);
}

/**
 * Pushes one canonical path and updates the rendered route without reloading.
 *
 * @param location - Root-relative landing or documentation URL.
 */
function navigateToLocation(location: string): void {
	const current = browserDocumentationLocation(window.location);

	if (current !== location) window.history.pushState(null, '', location);

	syncFromLocation(location);
}

/**
 * Synchronizes application state from a server or browser URL.
 *
 * @param location - Absolute or relative URL to render.
 */
function syncFromLocation(location: string): void {
	const route = parseDocumentationRoute(location);

	searchOpen.value = false;
	navigationOpen.value = false;

	if (route.kind === 'landing') {
		landingOpen.value = route.kind === 'landing';
		notFound.value = false;
		applyBrowserDocumentHead(route.kind, null);
		scrollToSection(route.sectionId);
		return;
	}

	if (route.kind === 'article') {
		const article = findArticle(route.articleId);

		if (article) {
			landingOpen.value = false;
			notFound.value = false;
			activeArticle.value = article;
			activePackage.value = article.packageName;
			applyBrowserDocumentHead('article', article);

			const canonical = documentationPath(article.id, route.sectionId);

			if (browserDocumentationLocation(window.location) !== canonical) {
				window.history.replaceState(null, '', canonical);
			}

			scrollToSection(route.sectionId);
			return;
		}
	}

	landingOpen.value = false;
	notFound.value = true;
	applyBrowserDocumentHead('not-found', null);
	scrollToSection('');
}

/**
 * Restores the browser URL after back or forward history navigation.
 */
function syncFromBrowser(): void {
	syncFromLocation(browserDocumentationLocation(window.location));
}

/**
 * Scrolls to an article section or to the beginning of the new page.
 *
 * @param sectionId - Optional decoded section identifier.
 */
function scrollToSection(sectionId: string): void {
	void nextTick(() => {
		if (sectionId) {
			document.getElementById(sectionId)?.scrollIntoView({
				behavior: 'smooth',
				block: 'start',
			});
			return;
		}

		window.scrollTo({ top: 0, behavior: 'smooth' });
	});
}

/**
 * Keeps title, canonical, search, and social metadata aligned after navigation.
 *
 * @param kind - Resolved client page kind.
 * @param article - Canonical article for an article page.
 */
function applyBrowserDocumentHead(kind: DocumentationPageKind, article: DocArticle | null): void {
	const metadata = documentationPageMetadata(kind, article);
	const existingCanonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
	const canonicalOrigin = existingCanonical?.href
		? new URL(existingCanonical.href).origin
		: window.location.origin;

	document.title = metadata.title;
	setMetaContent('name', 'description', metadata.description);
	setMetaContent('name', 'robots', metadata.robots);
	setMetaContent('property', 'og:title', metadata.description ? metadata.title : undefined);
	setMetaContent('property', 'og:description', metadata.description);
	setMetaContent('property', 'og:type', metadata.openGraphType);
	setMetaContent(
		'property',
		'og:url',
		metadata.canonicalPath ? new URL(metadata.canonicalPath, `${canonicalOrigin}/`).toString() : undefined,
	);

	if (metadata.canonicalPath) {
		const canonical = existingCanonical ?? document.createElement('link');

		canonical.rel = 'canonical';
		canonical.href = new URL(metadata.canonicalPath, `${canonicalOrigin}/`).toString();
		if (!existingCanonical) document.head.append(canonical);
	} else {
		existingCanonical?.remove();
	}
}

/**
 * Creates, updates, or removes one managed document meta element.
 *
 * @param attribute - Meta key namespace used by standard or Open Graph tags.
 * @param name - Metadata field name.
 * @param content - New content, or undefined to remove the field.
 */
function setMetaContent(
	attribute: 'name' | 'property',
	name: string,
	content: string | undefined,
): void {
	const selector = `meta[${attribute}="${name}"]`;
	const existing = document.head.querySelector<HTMLMetaElement>(selector);

	if (!content) {
		existing?.remove();
		return;
	}

	const element = existing ?? document.createElement('meta');

	element.setAttribute(attribute, name);
	element.content = content;
	if (!existing) document.head.append(element);
}

onMounted(() => {
	syncFromBrowser();
	window.addEventListener('keydown', handleKeydown);
	window.addEventListener('popstate', syncFromBrowser);
	document.addEventListener('click', handleDocumentClick);
});

onBeforeUnmount(() => {
	window.removeEventListener('keydown', handleKeydown);
	window.removeEventListener('popstate', syncFromBrowser);
	document.removeEventListener('click', handleDocumentClick);
});
</script>

<template>
	<div class="min-h-screen bg-canvas text-canvas-fg">
		<template v-if="landingOpen">
			<LandingHeader
				@navigate="navigateTo"
				@open-search="openSearch"
			/>
			<LandingPage />
		</template>

		<template v-else-if="notFound">
			<DocsHeader
				@open-navigation="navigationOpen = true"
				@open-search="openSearch"
			/>
			<main class="docs-article mx-auto min-h-[70vh] max-w-4xl">
				<p class="landing-section-label">404</p>
				<h1>Documentation page not found</h1>
				<p>The requested page is not part of this framework documentation version.</p>
				<a class="landing-primary-action mt-8 inline-flex" href="/">
					Return to db3.ai
				</a>
			</main>
		</template>

		<template v-else>
			<DocsHeader
				@open-navigation="navigationOpen = true"
				@open-search="openSearch"
			/>

			<div class="docs-workspace">
				<GlobalDocsRail :active-area="activeArea" />

				<DocsSidebar
					:active-article-id="activeArticle.id"
					:active-package="activePackage"
					:groups="groups"
					:open="navigationOpen"
					@close="closeNavigation"
					@select-package="selectPackage"
				/>

				<main class="min-w-0 border-border xl:border-r">
					<DocsArticle
						:article="activeArticle"
						:navigation="adjacentArticles"
					/>
				</main>

				<DocsOnThisPage
					:article="activeArticle"
					:related-articles="relatedArticles"
				/>
			</div>
		</template>

		<DocsSearch
			v-model:open="searchOpen"
			@select="selectArticle"
		/>
	</div>
</template>
