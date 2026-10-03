import type { DocArticle, DocContentSection } from './docs';

/**
 * Resolves the complete instructional body shared by HTML, Markdown and search.
 * Unplaced examples receive stable sections so no format silently hides code.
 * @param article - Registered article with prose and source-owned examples.
 * @returns Ordered sections, including any examples not already placed by the author.
 */
export function articleSections(article: DocArticle): DocContentSection[] {
	const placed = new Set(article.sections.map(section => section.codeSampleId));
	const ids = new Set(article.sections.map(section => section.id));
	const additional = (article.codeSamples ?? []).filter(sample => !placed.has(sample.id)).map(sample => {
		let id = `example-${sample.id}`;
		while (ids.has(id)) id = `extra-${id}`;
		ids.add(id);
		return { id, title: sample.title, paragraphs: [], codeSampleId: sample.id };
	});
	return [...article.sections, ...additional];
}

/** Identifies consumer-facing source documents allowed in public reference feeds. */
export function isPublicDocumentationSource(sourcePath: string): boolean {
	return /^packages\/app\/src\/[^/]+\/README\.md$/.test(sourcePath)
		|| sourcePath === 'packages/pure/README.md'
		|| sourcePath === 'apps/starter/README.md';
}

/** Returns the optional supporting reference URL without loading source files into the browser. */
export function articleReferencePath(article: DocArticle): string | undefined {
	if (article.includeSourceDocument === false || !isPublicDocumentationSource(article.sourcePath)) return;
	return `/framework/docs/${encodeURIComponent(article.id)}/reference.md`;
}
