import assert from 'node:assert/strict';
import test from 'node:test';
import { docArticles, findArticle } from '../client/docs';
import { documentationArticleMarkdown, llmsFullText } from '../client/documentationMarkdown';
import { frameworkAuthority } from '../client/generated/framework-authority';

test('the introduction explains the trade-off without claiming illustrative methods are framework APIs', () => {
	const article = findArticle('active-record')!;
	assert.deepEqual(article.sections.slice(0, 2).map(section => section.id), ['why-active-record', 'database-tradeoffs']);
	assert.equal(article.sections[0]!.title, 'Why ActiveRecord?');
	assert.match(article.sections[0]!.paragraphs.join(' '), /15 years/);
	assert.ok(article.sections[0]!.links?.some(link => link.articleId === article.id && link.sectionId === 'start-here'));
	const sample = article.codeSamples?.find(item => item.id === 'hidden-queries-pseudocode');
	assert.ok(sample);
	assert.match(sample.title, /pseudocode, not the db3.ai API/);
	assert.match(sample.code, /^\/\/ Illustrative pseudocode, not the db3.ai API\./);
	assert.equal(sample.output, undefined);
	const markdown = documentationArticleMarkdown(article);
	assert.doesNotMatch(markdown, /a note from Steve/i);
	assert.match(markdown, /it is not a db3.ai relationship or reporting API/);
	assert.match(markdown, /<a id="database-tradeoffs"><\/a>\n\n### The database is still there/);
	assert.match(markdown, /database-level escape hatch/);
});

test('the field-first explanation separates current behaviour from the broader design principle', () => {
	const article = findArticle('active-record')!;
	const section = article.sections.find(item => item.id === 'field-first')!;
	assert.ok(section);
	assert.ok(article.sections.indexOf(section) < article.sections.findIndex(item => item.id === 'start-here'));
	const text = section.paragraphs.join(' ');
	assert.match(text, /ActiveField describes the principle here, not a separate API/);
	assert.match(text, /ActiveRecord brings a named collection of fields together/);
	assert.match(text, /FieldType.*input.*validated.*stored and loaded.*JSON or a form/);
	assert.match(text, /PasswordField hashes a password/);
	assert.match(text, /EncryptedJsonField encrypts recoverable secrets/);
	assert.match(text, /does not automatically validate child fields/);
	assert.match(text, /isn’t a built-in nested-field schema API yet/);
	assert.equal(section.codeSampleId, undefined);
	assert.ok(section.links?.some(link => link.articleId === 'active-record-api' && link.sectionId === 'field-contract'));
	assert.match(documentationArticleMarkdown(article), /<a id="field-first"><\/a>\n\n## ActiveRecord, built around fields/);
});

test('ActiveRecord teaches the happy path, boundaries, coverage and next steps', () => {
	const article = findArticle('active-record')!;
	const text = article.sections.flatMap(section => section.paragraphs).join('\n');
	for (const section of ['prerequisites', 'define-fields', 'create-and-save', 'read-records', 'validation', 'update-and-delete', 'json', 'transactions', 'coverage']) {
		assert.ok(article.sections.some(item => item.id === section), `Missing task coverage: ${section}`);
	}
	assert.match(text, /create\(\).*unsaved/);
	assert.match(text, /does not authenticate/);
	assert.match(text, /not.*optimistic-locking/);
	assert.match(text, /partially selected records as read-only/);
	assert.ok(article.verifiedExample?.testPath.endsWith('workspaceNotes.test.ts'));
});

test('contextual links resolve to real articles and section anchors', () => {
	for (const article of docArticles) {
		const sections = new Set(article.sections.map(section => section.id));
		assert.equal(sections.size, article.sections.length, `${article.id}: duplicate section`);
		for (const section of article.sections) {
			for (const link of section.links ?? []) {
				if (link.href) {
					assert.equal(new URL(link.href).protocol, 'https:');
					continue;
				}
				const target = findArticle(link.articleId!);
				assert.ok(target, `${article.id}: missing ${link.articleId}`);
				if (link.sectionId) assert.ok(target.sections.some(item => item.id === link.sectionId), `${article.id}: missing #${link.sectionId}`);
			}
		}
	}
});

test('the advanced reference renders exact staged declarations', () => {
	const reference = findArticle('active-record-api')!;
	for (const sample of reference.codeSamples ?? []) {
		const entry = frameworkAuthority.publicExports.find(item => item.importPath === sample.title);
		assert.ok(entry);
		const declarations: Readonly<Record<string, string>> = frameworkAuthority.declarationSources;
		assert.equal(sample.code, declarations[entry.declarationPath]);
	}
	assert.equal(reference.codeSamples?.length, 4);
});

test('Markdown preserves contextual links and stable HTML-equivalent anchors', () => {
	const article = documentationArticleMarkdown(findArticle('active-record')!, { origin: 'https://preview.db3.ai', includeSourceDocument: false });
	assert.match(article, /https:\/\/preview\.db3\.ai\/framework\/docs\/active-record-api\.md#query-methods/);
	const reference = documentationArticleMarkdown(findArticle('active-record-api')!, { includeSourceDocument: false });
	assert.match(reference, /<a id="query-methods"><\/a>/);
	assert.match(article, /## What this guide covers/);
});

test('the problem catalogue labels unavailable recipes as planned guides', () => {
	const article = findArticle('solve-a-problem')!;
	const credits = article.sections.find(section => section.id === 'ai-credits')!;
	assert.match(credits.paragraphs.join(' '), /Planned guide/);
	assert.match(credits.paragraphs.join(' '), /not available yet/);
	assert.equal(credits.codeSampleId, undefined);
	assert.equal(article.verifiedExample, undefined);
	const recipe = findArticle('guide-workspace-notes')!;
	assert.match(recipe.sections.flatMap(section => section.paragraphs).join(' '), /Obtain.*tarballs/);
	assert.match(recipe.codeSamples![0]!.code, /npm pkg set type=module/);
	const recipeMarkdown = documentationArticleMarkdown(recipe);
	assert.match(recipeMarkdown, /Repository test command \(framework checkout only\)/);
	assert.match(recipeMarkdown, /In an installed application, use the walkthrough commands/);
	assert.equal(recipe.sections.find(section => section.id === 'run')?.codeSampleId, 'run-command');
	assert.equal(recipe.codeSamples?.find(sample => sample.id === 'run-command')?.code, 'npx tsx examples/runWorkspaceNotes.ts');
	assert.equal(recipe.sections.find(section => section.id === 'try-it')?.codeSampleId, 'type-check-command');
	assert.match(recipe.codeSamples?.find(sample => sample.id === 'type-check-command')?.code ?? '', /^npx tsc --noEmit/);
});

test('focused Markdown stays task-led while the complete feed retains source authority', () => {
	for (const id of ['active-record', 'guide-workspace-notes', 'active-record-api', 'solve-a-problem']) {
		assert.doesNotMatch(documentationArticleMarkdown(findArticle(id)!), /## Framework-owned source:/);
	}
	assert.match(llmsFullText(), /## Generated Database Migrations/);
	assert.doesNotMatch(documentationArticleMarkdown(findArticle('active-record')!, { includeSourceDocument: true }), /## Generated Database Migrations/);
});

test('inferred models are documented from the executable field-owned example', () => {
	const article = findArticle('active-record')!;
	const section = article.sections.find(item => item.id === 'inferred-model')!;
	const sample = article.codeSamples?.find(item => item.id === section.codeSampleId);
	assert.ok(sample);
	assert.match(sample.code, /extends ActiveRecord\.define\(/);
	assert.doesNotMatch(sample.code, /declare email/);
	assert.match(section.paragraphs.join(' '), /unsaved DefinedUser immediately/);
	assert.match(section.paragraphs.join(' '), /often `unknown`/);
	assert.ok(article.examplePaths?.includes('packages/app/src/db/examples/DefinedUser.ts'));
	assert.ok(article.additionalTestPaths?.includes('packages/app/src/db/tests/active-record-define.integration.test.ts'));
});

test('the primary model walkthrough and machine-readable guide prefer define with complete boundaries', () => {
	const article = findArticle('active-record')!;
	const sample = article.codeSamples!.find(item => item.id === 'note-model')!;
	assert.match(sample.code, /class KnowledgeNote extends ActiveRecord\.define\(/);
	assert.doesNotMatch(sample.code, /declare |static override fields/);
	const markdown = documentationArticleMarkdown(article);
	for (const section of ['definition-options', 'inferred-types', 'model-inheritance']) {
		assert.match(markdown, new RegExp(`<a id="${section}"></a>`));
	}
	assert.match(markdown, /Prefer `ActiveRecord\.define\(\)` for new models/);
	assert.match(markdown, /does not open a database connection, create a table or generate migrations/);
	assert.match(markdown, /broad `FieldInputMap` annotation loses/);
	assert.match(markdown, /both application and input value types/);
	assert.doesNotMatch(markdown, /The declare properties tell TypeScript|not yet a public create-app/);
	assert.match(llmsFullText(), /class KnowledgeNote extends ActiveRecord\.define\(/);
});
