import assert from 'node:assert/strict';
import test from 'node:test';
import { findArticle } from '../src/docs';
import { frameworkAuthority } from '../src/generated/framework-authority';
import { documentationArticleMarkdown } from '../src/documentationMarkdown';

test('Introduction gives the shortest existing path without presenting future APIs as shipped', () => {
	const article = findArticle('welcome')!;
	const markdown = documentationArticleMarkdown(article);
	assert.match(markdown, /not published to npm yet/);
	assert.match(markdown, /agent classes, function calls, saved conversations/);
	assert.ok(article.sections[0].links?.some(link => link.articleId === 'starter-app'));
	assert.equal(article.verifiedExample, undefined);
});

test('Config explains validation, presence and service wiring beside runnable examples', () => {
	const article = findArticle('config')!;
	const markdown = documentationArticleMarkdown(article);
	assert.match(markdown, /does not validate/);
	assert.match(markdown, /only when the property is absent/);
	assert.match(markdown, /not runtime validation/);
	assert.match(markdown, /APP_PORT=abc/);
	assert.ok(findArticle('app-config')!.sections.some(section => section.id === 'lifecycle'));
	const sources: Readonly<Record<string, string>> = frameworkAuthority.declarationSources;
	for (const path of findArticle('config-api')!.declarationPaths!) assert.ok(sources[path]?.trim());
});
