import assert from 'node:assert/strict';
import test from 'node:test';
import { findArticle } from '../src/docs';

test('starter teaches optional server-side BYOK and clearly separates preview from publication', () => {
	const article = findArticle('starter-app');
	assert.ok(article);
	assert.equal(article.packageName, '@db3.ai/create');
	assert.equal(article.testPath, 'apps/starter/tests/app.test.ts');
	const text = article.sections.flatMap(section => section.paragraphs).join('\n');
	assert.match(text, /not published to npm yet/);
	assert.match(text, /work without one/);
	assert.match(text, /server.*\.env/);
	assert.match(text, /simulated/);
	assert.match(text, /not a spending cap/);
	assert.match(text, /no Google sign-in screen/);
	assert.doesNotMatch(text, /not `create-app`|intended public entry point|first slice/);
	assert.equal(article.codeSamples?.find(sample => sample.id === 'create')?.code, 'npm create @db3.ai@latest my-app');
	assert.ok(article.sections.some(section => section.id === 'testing'));
	assert.ok(article.sections.some(section => section.id === 'coverage'));
});
