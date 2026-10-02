import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { docAreas, docArticles, documentationCommands, findArticle, navigationGroups, searchDocumentation } from '../src/docs';
import { frameworkPackageMetadata } from '../src/generated/framework-metadata';
import { serviceExampleOutputs, serviceExampleSources } from '../src/generated/service-examples';
import { helloGuideSamples } from '../../../packages/app/src/apps/examples/helloGuideSamples';
import { frameworkNavigation, guideNavigation, landingCapabilities, landingUseCases, mobileLandingNavigation, serviceNavigation } from '../src/landing';

test('every documentation area has navigable articles with unique identifiers', () => {
	const ids = docArticles.map(article => article.id);

	assert.equal(new Set(ids).size, ids.length);

	for (const area of docAreas) {
		const articles = docArticles.filter(article => article.area === area.id);

		assert.ok(articles.length > 0, `${area.label} should contain documentation`);
		assert.equal(
			navigationGroups(area.id).flatMap(group => group.articles).length,
			articles.length,
		);
	}
});

test('every landing-page destination resolves to a registered article', () => {
	const destinations = [
		...frameworkNavigation.map(item => item.value),
		...guideNavigation.map(item => item.value),
		...serviceNavigation.map(item => item.value),
		...mobileLandingNavigation.map(item => item.value),
		...landingCapabilities.map(item => item.target),
		...landingUseCases.map(item => item.target),
	];

	for (const destination of destinations) {
		assert.ok(findArticle(destination), `landing destination should resolve: ${destination}`);
	}
});

test('the introduction explains the human, AI and machine vision without claiming a finished visual editor', () => {
	const article = findArticle('welcome');
	const vision = article?.sections.find(section => section.id === 'vision');
	const body = vision?.paragraphs.join(' ') ?? '';

	assert.ok(vision);
	assert.equal(vision.visual, 'framework-vision');
	assert.match(body, /humans, AI collaborators and machines/);
	assert.match(body, /source code and explicit contracts/);
	assert.match(body, /visual models/);
	assert.match(body, /work in both directions/);
	assert.match(body, /validated, reviewable changes/);
	assert.match(body, /never become an opaque second source of truth/);
	assert.match(body, /do not yet constitute a complete visual editor/);
});

test('the comprehensive queue guide documents the current QueueableJob lifecycle', () => {
	const article = findArticle('queue-overview');
	const source = article?.codeSamples?.map(sample => sample.code).join('\n') ?? '';

	assert.ok(article);
	assert.equal(article.packageName, '@db3.ai/app/queue');
	assert.match(source, /extends QueueableJob/);
	assert.match(source, /async handle\(\): Promise<void>/);
	assert.match(source, /class GenerateReportJob extends QueueableJob/);
	assert.match(source, /registerJob\(GenerateReportJob\)/);
	assert.match(source, /queue\.dispatch\(new GenerateReportJob/);
	assert.ok(article.examplePaths?.includes('packages/app/src/queue/examples/GenerateReportJob.ts'));
	assert.ok(article.examplePaths?.includes('packages/app/src/queue/examples/outputs/create-and-process-report-job.json'));
	assert.equal(article.testPath, 'packages/app/src/queue/tests/examples/runQueueReports.test.ts');
	assert.equal(article.verifiedExample?.testPath, article.testPath);
	assert.match(article.verifiedExample?.command ?? '', /test:service.*queue/);
});

test('generated framework metadata matches the published package identity', () => {
	const packagePath = fileURLToPath(new URL('../../../packages/app/package.json', import.meta.url));
	const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { name: string; version: string };

	assert.deepEqual(frameworkPackageMetadata, {
		name: '@db3.ai/app',
		version: packageManifest.version,
	});
});

test('only executable examples are presented as verified examples', () => {
	const verifiedArticles = docArticles.filter(article => article.area === 'examples');

	assert.ok(verifiedArticles.length > 0);
	for (const article of verifiedArticles) {
		assert.ok(article.examplePaths?.length, `${article.id} should render service-owned source`);
		assert.ok(article.testPath, `${article.id} should reference its behavioural test`);
		assert.equal(article.verifiedExample?.testPath, article.testPath);
	}
});

test('the queue section is one comprehensive page with anchored subsections', () => {
	const article = findArticle('queue-overview');
	const sectionIds = article?.sections.map(section => section.id) ?? [];

	assert.ok(article);
	assert.equal(article.packageName, '@db3.ai/app/queue');
	assert.ok(sectionIds.includes('creating-jobs'));
	assert.ok(sectionIds.includes('job-lifecycle'));
	assert.ok(sectionIds.includes('chains-and-batches'));
	assert.ok(sectionIds.includes('retries-and-failures'));
	assert.equal(findArticle('queue-creating-jobs'), article);
	assert.equal(findArticle('queue-lifecycle'), article);
	assert.equal(findArticle('queue-chains'), article);
	assert.equal(findArticle('queue-failures'), article);
	assert.equal(docArticles.filter(candidate => candidate.packageName === '@db3.ai/app/queue' && candidate.area === 'services').length, 1);

	assert.match(
		article.codeSamples?.map(sample => sample.code).join('\n') ?? '',
		/dispatchReportPipeline/,
	);
	assert.match(
		article.codeSamples?.map(sample => sample.code).join('\n') ?? '',
		/retryReportAfterBackpressure/,
	);
});

/** Keeps the public app layout aligned with the creator's client/server convention. */
test('project structure explains the consuming application without contributor instructions', () => {
	const article = findArticle('project-structure');
	const body = article?.sections.flatMap(section => section.paragraphs).join(' ') ?? '';

	assert.ok(article);
	assert.equal(article.sourcePath, 'apps/starter/README.md');
	assert.match(body, /server\/models/);
	assert.match(body, /generate a migration/);
	assert.ok(article.relatedIds?.includes('guide-model-data'));
	assert.doesNotMatch(body, /Migrate small leaf services|contributing reusable code|maintenance gate/);
	assert.deepEqual(article.codeSamples?.map(sample => sample.id), ['starter-layout']);
	const layout = article.codeSamples?.[0]?.code ?? '';
	assert.match(layout, /\n\tclient\/\n/);
	assert.match(layout, /\n\tserver\/\n/);
	assert.doesNotMatch(layout, /\n\tsrc\//);
	assert.doesNotMatch(layout, /\n\tdatabase\//);
	assert.match(layout, /\n\t\tdatabase\/\n(?:\t\t\t[^\n]+\n)*\t\t\tmigrations\/\n\t\t\tschema\.snapshot\.json/);
	assert.match(body, /server\/database\/migrations/);
	assert.match(layout, /\n\t\tcli\.config\.ts\n/);
	assert.doesNotMatch(layout, /\n\t\t\tcli\.ts\n/);
	assert.match(body, /Change the UI under `client`/);
	assert.equal(article.verifiedExample, undefined);
});

test('documentation search ranks titles and package ownership', () => {
	assert.equal(searchDocumentation('queue retry')[0]?.id, 'queue-overview');
	assert.ok(searchDocumentation('@db3.ai/pure').some(article => article.id === 'package-pure'));
	assert.ok(searchDocumentation('managed media').some(article => article.id === 'media'));
});

test('the public package catalogue contains only release-supported DB3 packages', () => {
	const manifest = JSON.parse(readFileSync(new URL('../../../packages/app/package.json', import.meta.url), 'utf8')) as { exports: Record<string, unknown> };
	const imports = new Set(['@db3.ai/pure', ...Object.keys(manifest.exports).filter(path => !path.includes('*')).map(path => path === '.' ? '@db3.ai/app' : `@db3.ai/app/${path.slice(2)}`)]);
	assert.equal(findArticle('package-app')?.packageName, '@db3.ai/app');
	assert.equal(findArticle('package-pure')?.packageName, '@db3.ai/pure');
	for (const article of docArticles.filter(article => article.area === 'api')) {
		assert.ok(imports.has(article.packageName), `${article.id}: unsupported public package ${article.packageName}`);
	}
});

test('command palette entries preserve article ownership and search terms', () => {
	const commands = documentationCommands();
	const queueCommand = commands.find(command => command.value === 'queue-overview');

	assert.equal(commands.length, docArticles.length);
	assert.equal(queueCommand?.label, 'Queue');
	assert.match(queueCommand?.description ?? '', /Services · Application · @db3\.ai\/app\/queue/);
	assert.ok(queueCommand?.keywords.some(keyword => keyword.includes('queue background job')));
});

test('every article points to a current framework source', () => {
	for (const article of docArticles) {
		for (const sourcePath of [
			article.sourcePath,
			...(article.examplePaths ?? []),
			...(article.testPath ? [article.testPath] : []),
			...(article.additionalTestPaths ?? []),
		]) {
			const path = fileURLToPath(new URL(`../../../${sourcePath}`, import.meta.url));

			assert.doesNotThrow(() => statSync(path), `${article.id} source should exist: ${sourcePath}`);
		}
	}
});

test('generated documentation examples match their service-owned sources', () => {
	const examplePaths = {
		generateReportJob: 'packages/app/src/queue/examples/GenerateReportJob.ts',
		createAndProcessReportJob: 'packages/app/src/queue/examples/createAndProcessReportJob.ts',
		dispatchReportWorkflows: 'packages/app/src/queue/examples/dispatchReportWorkflows.ts',
		manageReportRetries: 'packages/app/src/queue/examples/manageReportRetries.ts',
		knowledgeNote: 'packages/app/src/db/examples/KnowledgeNote.ts',
		workspaceNotes: 'packages/app/src/db/examples/workspaceNotes.ts',
		createNotesTogether: 'packages/app/src/db/examples/createNotesTogether.ts',
		runWorkspaceNotes: 'packages/app/src/db/examples/runWorkspaceNotes.ts',
	} as const;

	for (const exampleId of Object.keys(examplePaths) as Array<keyof typeof examplePaths>) {
		const sourcePath = examplePaths[exampleId];
		const path = fileURLToPath(new URL(`../../../${sourcePath}`, import.meta.url));

		assert.equal(serviceExampleSources[exampleId], readFileSync(path, 'utf8'));
	}

	const outputPaths = {
		createAndProcessReportJob: 'packages/app/src/queue/examples/outputs/create-and-process-report-job.json',
		dispatchReportWorkflows: 'packages/app/src/queue/examples/outputs/dispatch-report-workflows.json',
		manageReportRetries: 'packages/app/src/queue/examples/outputs/manage-report-retries.json',
		workspaceNotes: 'packages/app/src/db/examples/outputs/workspace-notes.json',
	} as const;

	for (const outputId of Object.keys(outputPaths) as Array<keyof typeof outputPaths>) {
		const sourcePath = outputPaths[outputId];
		const path = fileURLToPath(new URL(`../../../${sourcePath}`, import.meta.url));

		assert.equal(serviceExampleOutputs[outputId], readFileSync(path, 'utf8'));
	}
});

/** Keeps the published copyable guide aligned with the independent packed-consumer check. */
test('the Hello guide renders the canonical public framework fragments', () => {
	const article = findArticle('apps');
	assert.ok(article);
	for (const [id, key] of [['hello-test', 'helloTest'], ['hello-test-explicit', 'helloTestExplicit'], ['hello-use', 'helloUse']] as const) {
		assert.equal(article.codeSamples?.find(sample => sample.id === id)?.code, helloGuideSamples[key]);
		assert.equal(serviceExampleSources[key], helloGuideSamples[key]);
	}
});
