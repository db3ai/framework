import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { generateFrameworkAuthority } from '../scripts/generate-framework-authority';
import { docArticles, findArticle } from '../client/docs';
import { documentationArticleMarkdown, documentationOrigin, documentationRobotsText, documentationSitemapXml, llmsFullText, llmsText } from '../client/documentationMarkdown';
import { documentationSourceContent } from '../client/generated/documentation-sources';
import { frameworkAuthority } from '../client/generated/framework-authority';

test('all public framework assets remain product-independent', () => {
	const websiteRoot = fileURLToPath(new URL('../', import.meta.url));
	const files = ['index.html'];

	for (const directory of ['client', 'public']) {
		if (directory === 'public' && !existsSync(join(websiteRoot, directory))) continue;
		for (const entry of readdirSync(join(websiteRoot, directory), { recursive: true, encoding: 'utf8' })) {
			const path = join(directory, entry);
			if (/\.(?:ts|vue|css|html|svg|json|txt|md)$/i.test(path) && statSync(join(websiteRoot, path)).isFile()) files.push(path);
		}
	}

	for (const path of files) {
		const content = readFileSync(join(websiteRoot, path), 'utf8');
		assert.doesNotMatch(content, /scout/i, `${path} must not mention private products`);
	}
});

test('public documentation never references private products', () => {
	const documents = {
		articles: JSON.stringify(docArticles),
		sources: JSON.stringify(documentationSourceContent),
		authority: JSON.stringify(frameworkAuthority),
		index: llmsText(),
		fullText: llmsFullText(),
		...Object.fromEntries(docArticles.map(article => [article.id, documentationArticleMarkdown(article)])),
	};

	for (const [name, content] of Object.entries(documents)) {
		assert.doesNotMatch(content, /scout/i, `${name} must speak only about publicly available framework capabilities`);
	}
});

test('generated framework source documents match registry files under the public package scope', () => {
	const publicSources = [...new Set(docArticles.map(article => article.sourcePath).filter(path => /^packages\/app\/src\/[^/]+\/README\.md$/.test(path) || path === 'packages/pure/README.md' || path === 'apps/starter/README.md'))].sort();
	assert.deepEqual(Object.keys(documentationSourceContent).sort(), publicSources);

	for (const [sourcePath, generatedSource] of Object.entries(documentationSourceContent)) {
		const path = fileURLToPath(new URL(`../../../${sourcePath}`, import.meta.url));

		assert.equal(generatedSource, readFileSync(path, 'utf8'), sourcePath);
	}
});

test('public guides describe final decisions without author or reviewer instructions', () => {
	const internalCopy = /not `create-app`|maintenance gate|Guidance for AI tools|Migrate small leaf services|Draft future workflows|Do not publish until npm access|independent guide-following review|The public package name does not rename|first slice|Do not build against invented APIs|before being presented as available|@platform\/(?:app|pure|db3)/i;
	assert.doesNotMatch(JSON.stringify(docArticles), internalCopy);
	for (const article of docArticles) {
		assert.doesNotMatch(documentationArticleMarkdown(article), internalCopy, article.id);
	}
	assert.doesNotMatch(llmsFullText(), internalCopy);
	assert.doesNotMatch(llmsText(), internalCopy);
});

test('public source exports exclude internal plans and release administration', () => {
	for (const path of ['plans/framework-goals.md', 'packages/app/CONVENTIONS.md', 'plans/README.md', 'packages/app/README.md']) {
		assert.equal(Object.hasOwn(documentationSourceContent, path), false, path);
	}
	assert.doesNotMatch(llmsFullText(), /# DB3 Framework Product Goals|## Review Checklist|Do not publish until npm access/);
	assert.match(llmsFullText(), /## Generated Database Migrations/);
});

test('generated behavioural authority matches every registry-owned test under public imports', () => {
	const registryTestPaths = new Set(docArticles.flatMap(article => [
		article.testPath,
		article.verifiedExample?.testPath,
		...(article.additionalTestPaths ?? []),
	].filter((testPath): testPath is string => Boolean(testPath))));

	assert.deepEqual(Object.keys(frameworkAuthority.behaviourTestSources).sort(), [...registryTestPaths].sort());

	for (const [testPath, generatedSource] of Object.entries(frameworkAuthority.behaviourTestSources)) {
		const path = fileURLToPath(new URL(`../../../${testPath}`, import.meta.url));

		assert.equal(generatedSource, readFileSync(path, 'utf8'), testPath);
	}
});

test('generated framework authority exactly matches a fresh consumer package stage', async () => {
	const freshAuthority = await generateFrameworkAuthority(new URL('../../../', import.meta.url), docArticles);

	assert.deepEqual(frameworkAuthority, freshAuthority);
});

test('generated public API authority matches publishable package subpaths', () => {
	const manifestPath = fileURLToPath(new URL('../../../packages/app/package.json', import.meta.url));
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
		name: string;
		version: string;
		engines: { node: string };
		exports: Record<string, string>;
	};
	const typedExports = Object.entries(manifest.exports)
		.filter((entry): entry is [string, string] => entry[1].startsWith('./src/'));

	assert.equal(frameworkAuthority.packageName, '@db3.ai/app');
	assert.equal(frameworkAuthority.version, manifest.version);
	assert.equal(frameworkAuthority.nodeVersion, manifest.engines.node);
	assert.equal(new Set(frameworkAuthority.publicExports.map(entry => entry.importPath)).size, frameworkAuthority.publicExports.length);

	for (const [subpathPattern, sourcePattern] of typedExports) {
		const matchingEntries = frameworkAuthority.publicExports.filter(entry => matchesExportPattern(entry.subpath, subpathPattern));

		assert.ok(matchingEntries.length > 0, `${subpathPattern} should generate at least one public declaration entry`);

		for (const entry of matchingEntries) {
			const wildcard = exportWildcard(entry.subpath, subpathPattern);
			const expectedDeclarationPath = sourcePattern
				.replace('./src/', 'dist/')
				.replace('*', wildcard)
				.replace(/\.ts$/, '.d.ts');

			assert.equal(entry.declarationPath, expectedDeclarationPath, entry.importPath);
			assert.ok(frameworkAuthority.declarationSources[entry.declarationPath]?.trim(), entry.declarationPath);
		}
	}

	for (const entry of frameworkAuthority.publicExports) {
		assert.ok(typedExports.some(([subpathPattern]) => matchesExportPattern(entry.subpath, subpathPattern)), entry.importPath);
	}

	const generatedContent = JSON.stringify(frameworkAuthority);

	assert.doesNotMatch(generatedContent, /github\.com\/steve-obrien\/platform|git@github\.com:steve-obrien\/platform|\/Users\/steve\//);
});

test('article Markdown keeps public API, source, examples, output, and test evidence together', () => {
	const article = findArticle('queue-overview');

	assert.ok(article);

	const markdown = documentationArticleMarkdown(article, { origin: 'https://preview.db3.ai/path' });

	assert.match(markdown, /^# Queue/m);
	assert.match(markdown, /Package: `@db3\.ai\/app\/queue`/);
	assert.match(markdown, /https:\/\/preview\.db3\.ai\/framework\/docs\/queue-overview\.md/);
	assert.match(markdown, /Framework source of truth: `packages\/app\/src\/queue\/README\.md`/);
	assert.match(markdown, /class GenerateReportJob extends QueueableJob/);
	assert.match(markdown, /Test-backed output/);
	assert.match(markdown, /Behaviour test: `packages\/app\/src\/queue\/tests\/examples\/runQueueReports\.test\.ts`/);
	assert.match(markdown, /Service reference \(Markdown\)/);
	assert.doesNotMatch(markdown, /## Framework-owned source/);
	assert.doesNotMatch(markdown, /Guidance for AI tools|invented APIs/);
});

test('Pure reference includes every staged typed export and the exact consumer test', () => {
	const article = findArticle('package-pure')!;
	for (const entry of frameworkAuthority.pure.publicExports) {
		const sample = article.codeSamples?.find(item => item.id === entry.importPath);
		assert.equal(sample?.code, frameworkAuthority.pure.declarationSources[entry.declarationPath]);
		assert.ok(sample?.code.trim());
	}
	assert.equal(article.codeSamples?.find(item => item.id === 'test-source')?.code, frameworkAuthority.behaviourTestSources['packages/pure/tests/noteTags.test.ts']);
	assert.match(llmsFullText(), /export declare function selectedStrings/);
});

test('external provider references retain their source URLs without becoming internal routes', () => {
	const markdown = documentationArticleMarkdown(findArticle('ai')!, { includeSourceDocument: false });
	assert.match(markdown, /\[OpenAI authentication guidance\]\(https:\/\/developers\.openai\.com\/api\/reference\/overview#authentication\)/);
	assert.match(markdown, /\[OpenAI data controls\]\(https:\/\/developers\.openai\.com\/api\/docs\/guides\/your-data\)/);
	assert.doesNotMatch(markdown, /docs\/undefined/);
});

test('llms index teaches from typed public APIs and executable evidence', () => {
	const document = llmsText();

	assert.match(document, /^# db3\.ai Framework/m);
	assert.match(document, /Learn APIs from public package subpaths and exported TypeScript contracts/);
	assert.match(document, /Learn behaviour from executable framework-owned examples/);
	assert.match(document, /https:\/\/db3\.ai\/framework\/docs\/package-app\.md/);
	assert.match(document, /https:\/\/db3\.ai\/framework\/docs\/queue-overview\.md/);
	assert.match(document, /packages\/app\/src\/queue\/tests\/examples\/runQueueReports\.test\.ts/);
	assert.match(document, /https:\/\/db3\.ai\/framework\/llms-full\.txt/);
});

test('complete AI context contains every registered article and verified source', () => {
	const document = llmsFullText({ origin: 'https://docs.example.test' });

	for (const article of docArticles) {
		assert.match(document, new RegExp(`# ${escapeRegExp(article.title)}(?:\\n|\\r)`));
		assert.match(document, new RegExp(escapeRegExp(article.sourcePath)));
	}

	assert.match(document, /https:\/\/docs\.example\.test\/framework\/llms\.txt/);
	assert.match(document, /queue\.dispatch\(new GenerateReportJob/);
	assert.match(document, /# Public package API authority/);
	assert.match(document, /`@db3\.ai\/app\/queue` → `dist\/queue\/index\.d\.ts`/);
	assert.match(document, /export declare function validate<TData/);
	assert.match(document, /# Selected behavioural-test source/);
	assert.match(document, /describe\('create and process report job example'/);
	assert.equal((document.match(/Framework-owned source: `packages\/app\/src\/queue\/README\.md`/g) ?? []).length, 1);
	assert.equal((document.match(/^## Behaviour test: `packages\/app\/src\/queue\/tests\/examples\/createAndProcessReportJob\.test\.ts`$/gm) ?? []).length, 1);
	assert.equal((document.match(/## Declaration entry point:/g) ?? []).length, Object.keys(frameworkAuthority.declarationSources).length);
	// Shared declarations and copied tests must not be duplicated in each article.
	const validationSource = frameworkAuthority.declarationSources['dist/validation/index.d.ts'];
	assert.ok(validationSource);
	assert.equal(document.split(validationSource.trim()).length - 1, 1);
	assert.match(document, /Exact shared source/);
	// The all-service completion plan adds full field/migration/service references.
	// Feature apps add their local/npm guide, installation contracts and lifecycle evidence.
	// The WebSocket guide adds seven executable shared-board sources and their integration test.
	// Keep the expanded, deduplicated export bounded; normal readers use per-page feeds.
	// Measure the production feed: repeating a longer preview host must not consume its budget.
	const productionBytes = Buffer.byteLength(llmsFullText());
	// Named queue selection adds public contracts, worker-pool guidance and driver discovery declarations.
	// Canonical Hello guide fragments and their independent consumer proof add public source provenance.
	// Exclude only the repeated mount prefix from the existing content budget.
	const contentBytes = Buffer.byteLength(llmsFullText().replaceAll('https://db3.ai/framework/', 'https://db3.ai/'));
	const mountOverhead = productionBytes - contentBytes;
	assert.ok(contentBytes < 1_730_000, `Production llms-full.txt is ${productionBytes} bytes; content must fit the 1.73 MB budget plus ${mountOverhead} bytes of mount-path overhead`);
	assert.doesNotMatch(document, /github\.com\/steve-obrien\/platform|git@github\.com:steve-obrien\/platform|\/Users\/steve\//);
});

test('sitemap and robots discovery documents use canonical registry routes', () => {
	const sitemap = documentationSitemapXml({ origin: 'https://docs.example.test/subpath' });
	const robots = documentationRobotsText({ origin: 'https://docs.example.test/subpath' });

	assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
	assert.match(sitemap, /<loc>https:\/\/docs\.example\.test\/framework\/docs\/welcome<\/loc>/);
	assert.equal((sitemap.match(/<url>/g) ?? []).length, docArticles.length + 1);
	assert.match(robots, /User-agent: \*/);
	assert.match(robots, /Allow: \//);
	assert.match(robots, /Sitemap: https:\/\/docs\.example\.test\/framework\/sitemap\.xml/);
	assert.match(robots, /\/framework\/llms\.txt/);
});

test('documentation origins accept only absolute HTTP website URLs', () => {
	assert.equal(documentationOrigin('https://db3.ai/framework/docs?preview=true'), 'https://db3.ai');
	assert.equal(documentationOrigin('http://localhost:4173'), 'http://localhost:4173');
	assert.throws(() => documentationOrigin('/relative'), /must be an absolute http or https URL/);
	assert.throws(() => documentationOrigin('file:///tmp/docs'), /must use http or https/);
});

/**
 * Escapes text before using it as an exact regular-expression fragment.
 *
 * @param value - Literal documentation text matched by a test.
 * @returns Regular-expression-safe source fragment.
 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reports whether a concrete generated subpath belongs to one manifest export.
 *
 * @param subpath - Concrete staged package export key.
 * @param pattern - Workspace export key with at most one wildcard.
 * @returns True when the concrete subpath is supplied by the manifest pattern.
 */
function matchesExportPattern(subpath: string, pattern: string): boolean {
	if (!pattern.includes('*')) return subpath === pattern;

	const [prefix, suffix] = pattern.split('*');

	return subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length > prefix.length + suffix.length;
}

/**
 * Extracts the wildcard value that maps a concrete export to its pattern.
 *
 * @param subpath - Concrete staged package export key.
 * @param pattern - Workspace export key with at most one wildcard.
 * @returns Matched wildcard segment, or an empty string for exact exports.
 */
function exportWildcard(subpath: string, pattern: string): string {
	if (!pattern.includes('*')) return '';

	const [prefix, suffix] = pattern.split('*');

	return subpath.slice(prefix.length, subpath.length - suffix.length);
}
