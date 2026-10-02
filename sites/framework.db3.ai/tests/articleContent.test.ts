import assert from 'node:assert/strict';
import test from 'node:test';
import { articleSections, articleReferencePath } from '../src/articleContent';
import { docArticles, findArticle, searchDocumentation, type DocArticle } from '../src/docs';
import { documentationArticleMarkdown } from '../src/documentationMarkdown';
import { documentationSourceContent } from '../src/generated/documentation-sources';

/** Guards the exact public content contract shared by both formats and navigation. */
test('every example has a section in the shared body and every reference is published', () => {
	for (const article of docArticles) {
		const sections = articleSections(article);
		assert.equal(new Set(sections.map(section => section.id)).size, sections.length, article.id);
		const markdown = documentationArticleMarkdown(article);
		for (const sample of article.codeSamples ?? []) {
			assert.ok(sections.some(section => section.codeSampleId === sample.id), `${article.id}: ${sample.id}`);
			assert.ok(markdown.includes(sample.code), `${article.id}: ${sample.id}`);
		}
		for (const section of sections) assert.ok(markdown.includes(`<a id="${section.id}"></a>`));
		if (articleReferencePath(article)) {
			assert.ok(Object.hasOwn(documentationSourceContent, article.sourcePath), article.id);
			assert.ok(markdown.includes(articleReferencePath(article)!));
		}
		assert.doesNotMatch(markdown, /## Framework-owned source:/);
	}
});

/** Proves that previously Markdown-only samples remain visible without duplicate anchors. */
test('unplaced samples get deterministic collision-free sections and existing placements remain intact', () => {
	const article: DocArticle = { ...findArticle('apps')!, sections: [{ id: 'example-extra', title: 'Existing', paragraphs: [], codeSampleId: 'placed' }], codeSamples: [
		{ id: 'placed', title: 'Placed', language: 'ts', code: 'one();' },
		{ id: 'extra', title: 'Extra', language: 'ts', code: 'two();' },
	] };
	assert.deepEqual(articleSections(article).map(section => section.id), ['example-extra', 'extra-example-extra']);
	assert.equal(articleSections(article).filter(section => section.codeSampleId === 'placed').length, 1);
	assert.equal(article.sections.length, 1);
});

/** Keeps the guide discoverable by exact implementation vocabulary. */
test('app creation and cleanup can be found through search', () => {
	assert.equal(searchDocumentation('defineApp')[0]?.id, 'apps');
	assert.ok(searchDocumentation('defer cleanup').some(article => article.id === 'apps'));
	const article = findArticle('apps')!;
	for (const id of ['start', 'service', 'install', 'run', 'lifecycle', 'define-app', 'testing', 'failures', 'production']) {
		assert.ok(articleSections(article).some(section => section.id === id));
	}
	assert.equal(articleReferencePath({ ...article, sourcePath: 'docs/internal-plan.md' }), undefined);
});
