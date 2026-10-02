import { articleSections, articleReferencePath } from './articleContent';
import { docAreas, docArticles, type DocArticle, type DocCodeSample } from './docs';
import { documentationSourceContent } from './generated/documentation-sources';
import { frameworkAuthority } from './generated/framework-authority';
import { frameworkPackageMetadata } from './generated/framework-metadata';

/** Canonical production origin for the db3.ai documentation website. */
export const DEFAULT_DOCUMENTATION_ORIGIN = 'https://framework.db3.ai';

/** Creates an unambiguous anchor for exact source retained in the full export. */
function authorityAnchor(kind: string, path: string): string {
	return `${kind}-${encodeURIComponent(path)}`;
}

/** Renders exact code once in a combined export while standalone pages stay complete. */
function renderSharedCodeSample(sample: DocCodeSample, location: string, references?: Map<string, string>): string {
	if (!references) return renderCodeSample(sample);
	const key = sample.code.trim();
	const existing = references.get(key);
	if (existing) return `### ${sample.title}\n\n[Exact shared source: ${sample.title}](${existing})`;
	references.set(key, location);
	return renderCodeSample(sample);
}

/**
 * Options shared by the generated AI-readable documentation surfaces.
 */
export interface DocumentationMarkdownOptions {
	/** Absolute public origin used for canonical links. */
	origin?: string;
	/** Whether to link the supporting service reference; the instructional body always matches HTML. */
	includeSourceDocument?: boolean;
	/** Internal full-export registry: identical code is rendered once, then linked. */
	sharedCodeReferences?: Map<string, string>;
}

/**
 * Renders one registry article as a complete standalone Markdown document.
 *
 * The rendered document keeps curated guidance, imported example source,
 * deterministic output, and behavioural-test evidence together so an AI tool
 * does not need to infer framework behaviour from an isolated code fragment.
 *
 * @param article - Canonical documentation registry entry to render.
 * @param options - Optional public-origin override used by previews and tests.
 * @returns LLM-readable Markdown with canonical links and source evidence.
 */
export function documentationArticleMarkdown(
	article: DocArticle,
	options: DocumentationMarkdownOptions = {},
): string {
	const origin = documentationOrigin(options.origin);
	const blocks: string[] = [
		`# ${article.title}`,
		`> ${article.summary}`,
		[
			`- Package: \`${article.packageName}\``,
			`- Canonical page: [${articleUrl(article, origin)}](${articleUrl(article, origin)})`,
			`- Markdown: [${articleMarkdownUrl(article, origin)}](${articleMarkdownUrl(article, origin)})`,
			`- Framework source of truth: \`${article.sourcePath}\``,
		].join('\n'),
	];

	if (article.steps?.length) {
		blocks.push([
			'## Workflow',
			...article.steps.map((step, index) => `${index + 1}. **${step.title}** — ${step.description}`),
		].join('\n'));
	}

	for (const section of articleSections(article)) {
		const sample = article.codeSamples?.find(candidate => candidate.id === section.codeSampleId);
		const heading = `${'#'.repeat(section.level ?? 2)} ${section.title}`;
		const sectionBlocks = [`<a id="${xmlText(section.id)}"></a>`, heading, ...section.paragraphs];
		if (section.links?.length) {
			sectionBlocks.push(section.links.map(link => {
				if (link.href) return `- [${link.label}](${link.href})`;
				const target = new URL(`/docs/${encodeURIComponent(link.articleId!)}.md`, origin);
				if (link.sectionId) target.hash = link.sectionId;
				return `- [${link.label}](${target.toString()})`;
			}).join('\n'));
		}

		if (sample) {
			sectionBlocks.push(renderSharedCodeSample(sample, new URL(`#${section.id}`, articleMarkdownUrl(article, origin)).toString(), options.sharedCodeReferences));
		}

		blocks.push(sectionBlocks.join('\n\n'));
	}

	if (article.verifiedExample) {
		blocks.push([
			'## Behavioural verification',
			article.verifiedExample.description,
			`- Behaviour test: \`${article.verifiedExample.testPath}\``,
			`- Repository test command (framework checkout only): \`${article.verifiedExample.command}\``,
			'- In an installed application, use the walkthrough commands instead of this repository test.',
			`- Expected outcome: ${article.verifiedExample.expectedOutput}`,
			`- Environment: ${article.verifiedExample.environment}`,
		].join('\n'));
	} else if (article.testPath) {
		blocks.push([
			'## Behavioural verification',
			`- Behaviour test: \`${article.testPath}\``,
		].join('\n'));
	}

	const relatedArticles = (article.relatedIds ?? [])
		.map(id => docArticles.find(candidate => candidate.id === id))
		.filter((candidate): candidate is DocArticle => Boolean(candidate));

	if (article.additionalTestPaths?.length) {
		blocks.push([
			'## Additional example tests',
			...article.additionalTestPaths.map(path => `- \`${path}\``),
		].join('\n'));
	}

	if (relatedArticles.length) {
		blocks.push([
			'## Related documentation',
			...relatedArticles.map(candidate => `- [${candidate.title}](${articleMarkdownUrl(candidate, origin)}): ${candidate.summary}`),
		].join('\n'));
	}

	const reference = articleReferencePath(article);
	if (reference && options.includeSourceDocument !== false) {
		blocks.push(`## Supporting reference\n\n[Service reference (Markdown)](${new URL(reference, origin).toString()}): additional package documentation.`);
	}

	return `${blocks.join('\n\n')}\n`;
}

/**
 * Renders the compact public index used by AI tools to discover framework docs.
 *
 * This file intentionally routes readers to canonical, version-consistent
 * Markdown rather than duplicating the complete framework reference.
 *
 * @param options - Optional public-origin override used by previews and tests.
 * @returns Compact llms.txt document generated from the documentation registry.
 */
export function llmsText(options: DocumentationMarkdownOptions = {}): string {
	const origin = documentationOrigin(options.origin);
	const blocks: string[] = [
		'# db3.ai Framework',
		`> Typed application framework documentation for ${frameworkPackageMetadata.name} ${frameworkPackageMetadata.version}, generated from the public documentation registry, package-owned source, executable examples, and behavioural tests.`,
		[
			'Use these documents as the canonical learning context for the db3.ai Framework.',
			'Learn APIs from public package subpaths and exported TypeScript contracts. Learn behaviour from executable framework-owned examples, their deterministic output, and the tests that execute them. Do not invent methods from prose or rely on source-relative internal imports.',
		].join('\n\n'),
		[
			'## Recommended learning order',
			'1. Read the introduction, installation, and first-application guides.',
			'2. Read the service page for the capability being used.',
			'3. Confirm names and payloads against the typed public API pages.',
			'4. Follow verified examples and their behavioural tests for runtime semantics, failures, retries, and cleanup.',
			'5. Use the complete context export only when broad framework knowledge is required.',
		].join('\n'),
		[
			'## Complete learning context',
			`- [llms-full.txt](${new URL('/llms-full.txt', origin).toString()}): Combined Markdown for every registered framework article, publish-shaped declaration entry points, exact selected behavioural tests, code examples, and deterministic output.`,
		].join('\n'),
	];

	for (const area of docAreas) {
		const articles = docArticles.filter(article => article.area === area.id);

		blocks.push([
			`## ${area.label}`,
			area.description,
			...articles.map(article => documentationIndexEntry(article, origin)),
		].join('\n'));
	}

	const verifiedArticles = docArticles.filter(article => article.verifiedExample || article.testPath);

	blocks.push([
		'## Executable evidence',
		'Prefer these pages when learning runtime behaviour because their displayed examples are tied to framework-owned tests.',
		...verifiedArticles.map(article => {
			const testPath = article.verifiedExample?.testPath ?? article.testPath;

			return `- [${article.title}](${articleMarkdownUrl(article, origin)}): behavioural evidence in \`${testPath}\`.`;
		}),
	].join('\n'));

	return `${blocks.join('\n\n')}\n`;
}

/**
 * Renders every registered article into one comprehensive Markdown export.
 *
 * @param options - Optional public-origin override used by previews and tests.
 * @returns Complete registry-ordered documentation suitable for broad AI context.
 */
export function llmsFullText(options: DocumentationMarkdownOptions = {}): string {
	const origin = documentationOrigin(options.origin);
	const sharedCodeReferences = new Map<string, string>([
		...Object.entries(frameworkAuthority.declarationSources).map(([path, source]) => [source.trim(), `#${authorityAnchor('declaration', path)}`] as [string, string]),
		...Object.entries(frameworkAuthority.behaviourTestSources).map(([path, source]) => [source.trim(), `#${authorityAnchor('test', path)}`] as [string, string]),
	]);
	const articles = docArticles.map(article => documentationArticleMarkdown(article, {
		origin,
		includeSourceDocument: false,
		sharedCodeReferences,
	}));
	const sourceDocuments = Object.entries(documentationSourceContent)
		.map(([sourcePath, source]) => renderFrameworkSourceDocument(sourcePath, source));
	const publicApiAuthority = renderPublicApiAuthority();
	const behaviouralTestAuthority = renderBehaviouralTestAuthority();
	const introduction = [
		'# db3.ai Framework — complete documentation',
		`> Complete AI-readable documentation for ${frameworkPackageMetadata.name} ${frameworkPackageMetadata.version}.`,
		'Use the clean staged package exports and declaration entry points below as the typed API authority. Use executable examples and the exact selected behavioural-test sources as the behavioural authority. Each article records its framework-owned source of truth.',
		`Compact index: ${new URL('/llms.txt', origin).toString()}`,
	].join('\n\n');

	return `${introduction}\n\n---\n\n${publicApiAuthority}\n\n---\n\n${articles.join('\n\n---\n\n').trimEnd()}\n\n---\n\n# Framework-owned source documents\n\n${sourceDocuments.join('\n\n---\n\n')}\n\n---\n\n${behaviouralTestAuthority}\n`;
}

/**
 * Renders the publish-shaped package subpaths and exact declaration entry
 * points captured by the clean framework staging workflow.
 *
 * @returns Compact typed API authority with each declaration included once.
 */
function renderPublicApiAuthority(): string {
	const exportInventory = frameworkAuthority.publicExports.map(entry => (
		`- \`${entry.importPath}\` → \`${entry.declarationPath}\``
	));
	const declarations = Object.entries(frameworkAuthority.declarationSources).map(([declarationPath, source]) => [
		`<a id="${authorityAnchor('declaration', declarationPath)}"></a>`,
		`## Declaration entry point: \`${declarationPath}\``,
		fencedCode(source, 'typescript'),
	].join('\n\n'));

	return [
		'# Public package API authority',
		`This inventory was compiled from a clean publish-shaped \`${frameworkAuthority.packageName}\` ${frameworkAuthority.version} package. It records the TypeScript entry points consumers can import under Node.js ${frameworkAuthority.nodeVersion}; source-relative modules outside this inventory are not public package APIs.`,
		[
			'## Public TypeScript imports',
			...exportInventory,
		].join('\n'),
		[
			'# Exact public declaration entry points',
			'These are the exact emitted `.d.ts` entry points referenced by the staged package manifest. Barrel declarations identify further exported declarations without promoting private source paths into supported imports.',
			...declarations,
		].join('\n\n'),
	].join('\n\n');
}

/**
 * Renders exact source for every behavioural test cited by the documentation
 * registry, deduplicating tests shared by several related articles.
 *
 * @returns Selected framework behavioural-test source authority.
 */
function renderBehaviouralTestAuthority(): string {
	const testSources = Object.entries(frameworkAuthority.behaviourTestSources).map(([testPath, source]) => [
		`<a id="${authorityAnchor('test', testPath)}"></a>`,
		`## Behaviour test: \`${testPath}\``,
		'Exact framework-owned test source captured by the documentation build:',
		fencedCode(source, sourceLanguage(testPath)),
	].join('\n\n'));

	return [
		'# Selected behavioural-test source',
		'These are the exact tests cited by registered articles. A shared test appears once even when it verifies several related pages. Treat assertions and observable outcomes as behavioural authority; test-only helpers are not public application APIs.',
		...testSources,
	].join('\n\n');
}

/**
 * Builds the canonical XML sitemap for public HTML documentation pages.
 *
 * AI-specific text and Markdown feeds are linked by llms.txt and therefore do
 * not compete with the rendered pages as canonical search results.
 *
 * @param options - Optional public-origin override used by previews and tests.
 * @returns XML sitemap containing the homepage and every registry article.
 */
export function documentationSitemapXml(options: DocumentationMarkdownOptions = {}): string {
	const origin = documentationOrigin(options.origin);
	const urls = [
		new URL('/', origin).toString(),
		new URL('/framework', origin).toString(),
		...docArticles.map(article => articleUrl(article, origin)),
	];
	const entries = urls.map(url => `\t<url>\n\t\t<loc>${xmlText(url)}</loc>\n\t</url>`).join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/**
 * Builds the crawler policy for the public documentation website.
 *
 * @param options - Optional public-origin override used by previews and tests.
 * @returns Permissive robots.txt with the canonical sitemap location.
 */
export function documentationRobotsText(options: DocumentationMarkdownOptions = {}): string {
	const origin = documentationOrigin(options.origin);

	return [
		'User-agent: *',
		'Allow: /',
		'',
		`Sitemap: ${new URL('/sitemap.xml', origin).toString()}`,
		'',
		'# AI-readable framework documentation is available at /llms.txt.',
		'',
	].join('\n');
}

/**
 * Normalizes a configured website origin to a safe absolute HTTP origin.
 *
 * @param configuredOrigin - Environment or caller supplied canonical origin.
 * @returns Normalized origin without path, query, or fragment components.
 */
export function documentationOrigin(configuredOrigin?: string): string {
	const candidate = configuredOrigin || DEFAULT_DOCUMENTATION_ORIGIN;
	let url: URL;

	try {
		url = new URL(candidate);
	} catch {
		throw new Error('The documentation origin must be an absolute http or https URL.');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('The documentation origin must use http or https.');
	}

	return url.origin;
}

/**
 * Renders one source example with its deterministic output and explanation.
 *
 * @param sample - Registry-owned source sample to render.
 * @returns Complete Markdown subsection for the example.
 */
function renderCodeSample(sample: DocCodeSample): string {
	const blocks = [
		`### ${sample.title}`,
		fencedCode(sample.code, sample.language),
	];

	if (sample.output) {
		blocks.push([
			'#### Test-backed output',
			fencedCode(sample.output, sample.outputLanguage ?? 'text'),
		].join('\n\n'));
	}

	if (sample.explanation?.length) {
		blocks.push([
			'#### What this demonstrates',
			...sample.explanation.map(point => `- ${point}`),
		].join('\n'));
	}

	return blocks.join('\n\n');
}

/**
 * Renders an exact registry source file without letting its own Markdown
 * headings or fences alter the surrounding generated document structure.
 *
 * @param sourcePath - Repository-relative source of truth.
 * @param source - Generated build-time snapshot of the trusted source file.
 * @returns Markdown section containing the exact file in a safe outer fence.
 */
function renderFrameworkSourceDocument(sourcePath: string, source: string): string {
	return [
		`## Framework-owned source: \`${sourcePath}\``,
		'This is the exact source document captured by the documentation build. Use it for detailed API and workflow guidance, subject to the public package exports and behavioural evidence identified above.',
		fencedCode(source, sourceLanguage(sourcePath)),
	].join('\n\n');
}

/**
 * Wraps trusted source text in a fence longer than any contained backtick run.
 *
 * @param source - Source or output text rendered verbatim.
 * @param language - Syntax identifier written after the opening fence.
 * @returns Markdown fenced-code block that cannot be closed by its content.
 */
function fencedCode(source: string, language: string): string {
	let longestBacktickRun = 0;

	for (const match of source.matchAll(/`+/g)) {
		longestBacktickRun = Math.max(longestBacktickRun, match[0].length);
	}

	const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));

	return `${fence}${language}\n${source.trimEnd()}\n${fence}`;
}

/**
 * Selects a syntax name for a generated framework source document.
 *
 * @param sourcePath - Repository-relative file path.
 * @returns Markdown syntax identifier appropriate for the source extension.
 */
function sourceLanguage(sourcePath: string): string {
	if (sourcePath.endsWith('.md')) return 'markdown';
	if (sourcePath.endsWith('.ts')) return 'typescript';
	if (sourcePath.endsWith('.json')) return 'json';

	return 'text';
}

/**
 * Renders one llms.txt catalogue entry from the canonical article metadata.
 *
 * @param article - Registry entry included in the learning index.
 * @param origin - Normalized public documentation origin.
 * @returns Markdown link with ownership and purpose context.
 */
function documentationIndexEntry(article: DocArticle, origin: string): string {
	return `- [${article.title}](${articleMarkdownUrl(article, origin)}): ${article.summary} Public import: \`${article.packageName}\`.`;
}

/**
 * Builds the canonical rendered-page URL for one documentation article.
 *
 * @param article - Registry entry being linked.
 * @param origin - Normalized public documentation origin.
 * @returns Absolute HTML page URL.
 */
function articleUrl(article: DocArticle, origin: string): string {
	return new URL(`/docs/${encodeURIComponent(article.id)}`, origin).toString();
}

/**
 * Builds the AI-readable Markdown URL for one documentation article.
 *
 * @param article - Registry entry being linked.
 * @param origin - Normalized public documentation origin.
 * @returns Absolute Markdown document URL.
 */
function articleMarkdownUrl(article: DocArticle, origin: string): string {
	return new URL(`/docs/${encodeURIComponent(article.id)}.md`, origin).toString();
}

/**
 * Escapes a value for an XML text node.
 *
 * @param value - Canonical URL written into the XML document.
 * @returns XML-safe text.
 */
function xmlText(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll('\'', '&apos;');
}
