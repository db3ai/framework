import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const indexHtml = readSource('../index.html');
const clientEntrySource = readSource('../src/entry-client.ts');
const domStudioStyles = readSource('../src/dom-studio.css');
const docsStyles = readSource('../src/style.css');
const landingStyles = readSource('../src/landing.css');
const headerSource = readSource('../src/components/DocsHeader.vue');
const landingHeaderSource = readSource('../src/components/LandingHeader.vue');
const contextRailSource = readSource('../src/components/DocsOnThisPage.vue');
const landingPageSource = readSource('../src/components/LandingPage.vue');
const frameworkDiagramSource = readSource('../src/components/FrameworkDiagram.vue');
const sidebarSource = readSource('../src/components/DocsSidebar.vue');
const searchSource = readSource('../src/components/DocsSearch.vue');
const themeToggleSource = readSource('../src/components/DocsThemeToggle.vue');
const articleSource = readSource('../src/components/DocsArticle.vue');
const codeExampleSource = readSource('../src/components/DocsCodeExample.vue');
const viteSource = readSource('../vite.config.ts');

test('theme state is applied before the documentation app mounts', () => {
	const bootstrapIndex = indexHtml.indexOf("localStorage.getItem('theme-mode')");
	const clientEntryIndex = indexHtml.indexOf('src="/src/entry-client.ts"');

	assert.notEqual(bootstrapIndex, -1);
	assert.ok(clientEntryIndex > bootstrapIndex);
	assert.match(indexHtml, /document\.documentElement\.dataset\.theme/);
	assert.ok(clientEntrySource.indexOf('.mount(') < clientEntrySource.indexOf('initTheme();'));
});

test('the app uses Tailwind v4 with DOM Studio semantic themes and components', () => {
	assert.match(viteSource, /@tailwindcss\/vite/);
	assert.match(viteSource, /isCustomElement: isDomStudioCustomElement/);
	assert.match(viteSource, /tag\.startsWith\('dom-'\)/);
	assert.match(domStudioStyles, /@import "@getdom\/studio\/style\.css"/);
	assert.match(domStudioStyles, /\[data-theme="light"\]/);
	assert.match(domStudioStyles, /\[data-theme="dark"\]/);
	assert.match(domStudioStyles, /--canvas:/);
	assert.match(domStudioStyles, /--primary:/);
	assert.match(headerSource, /DocsThemeToggle/);
	assert.match(headerSource, /frameworkPackageMetadata\.version/);
	assert.match(headerSource, /href="\/llms\.txt"/);
	assert.match(landingHeaderSource, /href="\/llms\.txt"/);
	assert.match(contextRailSource, /Read as Markdown/);
	assert.doesNotMatch(
		`${headerSource}\n${landingHeaderSource}\n${contextRailSource}`,
		/github\.com\/steve-obrien\/platform/,
	);
	assert.doesNotMatch(headerSource, /versionItems|v1\.4\.0|['"]Next['"]/);
	assert.match(sidebarSource, /DomDropdown/);
	assert.match(searchSource, /DomCommandPalette/);
	assert.doesNotMatch(headerSource, /<select\b/);
	assert.doesNotMatch(sidebarSource, /<select\b/);
	assert.match(themeToggleSource, /DomIconButton/);
	assert.match(themeToggleSource, /useTheme/);
	assert.match(articleSource, /DocsCodeExample/);
	assert.match(codeExampleSource, /DomCodeBlock/);
	assert.match(codeExampleSource, /Tested output/);
	assert.match(landingHeaderSource, /DomDropdown/);
	assert.match(landingHeaderSource, /DocsThemeToggle/);
	assert.match(landingPageSource, /The TypeScript framework for apps with AI\./);
	assert.match(frameworkDiagramSource, /VueFlow/);
	assert.match(docsStyles, /@apply[^;]*bg-canvas/);
	assert.match(docsStyles, /@apply[^;]*text-canvas-fg/);
	assert.match(docsStyles, /@apply[^;]*border-border/);
	assert.doesNotMatch(docsStyles, /\bbg-white\b|\btext-black\b|#[0-9a-f]{3,8}\b/i);
	assert.doesNotMatch(landingStyles, /\bbg-white\b|\btext-black\b|#[0-9a-f]{3,8}\b/i);
});

/**
 * Reads a docs application source file relative to this test module.
 *
 * @param path - Module-relative source path.
 * @returns UTF-8 source contents.
 */
function readSource(path: string): string {
	return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}
