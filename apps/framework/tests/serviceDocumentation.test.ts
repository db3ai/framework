import assert from 'node:assert/strict';
import test from 'node:test';
import { docArticles, findArticle } from '../client/docs';
import { frameworkAuthority } from '../client/generated/framework-authority';
import { documentationArticleMarkdown } from '../client/documentationMarkdown';

test('each new service guide has setup, run, consumer testing and honest coverage', () => {
	for (const id of ['auth', 'storage', 'media', 'scheduler', 'config', 'mail', 'validation', 'cache', 'events', 'logging', 'security', 'url', 'serialization', 'ssr', 'flows']) {
		const article = findArticle(id)!;
		for (const section of ['setup', 'run', 'testing', 'run-tests', 'coverage']) {
			assert.ok(article.sections.some(item => item.id === section), `${id}: missing ${section}`);
		}
		assert.ok(article.examplePaths?.length);
		assert.ok(article.verifiedExample);
		const sources: Readonly<Record<string, string>> = frameworkAuthority.behaviourTestSources;
		assert.equal(article.codeSamples?.find(sample => sample.id === 'test-source')?.code, sources[article.testPath!]);
		assert.match(article.codeSamples?.find(sample => sample.id === 'test-lab')?.code ?? '', /npx vitest run tests\//);
	}
});

test('the complete service index leads to specific guides and exact nonempty references', () => {
	const index = findArticle('api-reference')!;
	for (const section of index.sections) {
		const link = section.links?.find(item => item.articleId?.endsWith('-api'));
		if (!link?.articleId) continue;
		const reference = findArticle(link.articleId)!;
		assert.ok(reference.codeSamples?.length, reference.id);
		for (const sample of reference.codeSamples ?? []) {
			assert.ok(sample.code.trim(), `${reference.id}: ${sample.id}`);
			assert.ok(Object.values(frameworkAuthority.declarationSources).some(source => source === sample.code), `${reference.id}: declaration not from staged package`);
		}
	}
	for (const article of docArticles) {
		assert.doesNotMatch(article.sections.flatMap(section => section.paragraphs).join('\n'), /The complete guide will keep|This page is the framework-owned home for/);
	}
});

test('installation distinguishes unavailable npm release from a working tarball preview', () => {
	const markdown = documentationArticleMarkdown(findArticle('installation')!);
	assert.match(markdown, /not published to npm yet/);
	assert.match(markdown, /After publication only/);
	assert.match(markdown, /npm install @db3\.ai\/app/);
	assert.match(markdown, /npm install \/path\/to\/db3.ai-pure-0.1.0.tgz \/path\/to\/db3.ai-app-0.1.0.tgz/);
	assert.match(markdown, /DATABASE_URL.*takes precedence/);
	assert.match(documentationArticleMarkdown(findArticle('create-app')!), /server.inject\(\)/);
	assert.match(markdown, /\/framework\/docs\/create-app\.md#layout/);
	assert.match(documentationArticleMarkdown(findArticle('create-app')!), /my-db3-app\/[\s\S]*examples\/[\s\S]*tests\//);
});

test('all section code references exist and code spans survive Markdown export', () => {
	for (const article of docArticles) {
		for (const section of article.sections) {
			if (!section.codeSampleId) continue;
			const sample = article.codeSamples?.find(item => item.id === section.codeSampleId);
			assert.ok(sample?.code?.trim(), `${article.id}#${section.id}: missing or empty code sample`);
		}
	}
	assert.match(documentationArticleMarkdown(findArticle('active-record')!), /`save\(\)`/);
});
