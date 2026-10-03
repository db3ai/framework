import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { findArticle } from '../client/docs';
import { frameworkAuthority } from '../client/generated/framework-authority';
import { serviceExampleSources } from '../client/generated/service-examples';

test('Queue teaches an independent SQL workflow, safety boundaries and consumer tests', () => {
	const article = findArticle('queue-overview')!;
	const body = article.sections.flatMap(section => section.paragraphs).join('\n');
	for (const id of ['setup', 'run', 'application-worker', 'worker-commands', 'transactions', 'shutdown', 'testing', 'coverage']) {
		assert.ok(article.sections.some(section => section.id === id), id);
	}
	assert.match(body, /not an atomic workflow handoff/);
	assert.match(body, /there is no `fixed` strategy/);
	assert.match(body, /not a handler timeout/);
	assert.match(body, /does not stop queue workers or close a Redis/);
	assert.match(body, /not globally installed executables/);
	assert.equal(article.testPath, 'packages/app/src/queue/tests/examples/runQueueReports.test.ts');
	assert.ok(article.codeSamples?.find(sample => sample.id === 'test-source')?.code.includes('runQueueReports'));
});

test('Queue starts with an application job and dispatch before standalone labs', () => {
	const article = findArticle('queue-overview')!;
	assert.equal(article.sections[0].id, 'app-start');
	assert.ok(article.sections.findIndex(section => section.id === 'app-run') < article.sections.findIndex(section => section.id === 'setup'));
	assert.equal(article.codeSamples?.find(sample => sample.id === 'app-job')?.code, serviceExampleSources.generateReportJob);
	assert.match(article.codeSamples?.find(sample => sample.id === 'app-dispatch')?.code ?? '', /app\(\)\.queue\.dispatch/);
	assert.match(article.codeSamples?.find(sample => sample.id === 'app-console')?.code ?? '', /createApplication\(readConfig\(\)\)/);
	assert.doesNotMatch(article.sections.slice(0, 6).map(section => section.paragraphs.join(' ')).join('\n'), /copy the shipped|disposable database|test account/i);
});

test('Queue reference renders exact staged contracts, not only barrel exports', () => {
	const article = findArticle('queue-api')!;
	const declarations: Readonly<Record<string, string>> = frameworkAuthority.declarationSources;
	assert.equal(article.declarationPaths?.length, article.codeSamples?.length);
	article.declarationPaths!.forEach((path, index) => {
		assert.ok(declarations[path]?.trim(), path);
		assert.equal(article.codeSamples![index].code, declarations[path]);
	});
	assert.match(article.codeSamples!.map(sample => sample.code).join('\n'), /interface DispatchOptions/);
	assert.match(article.codeSamples!.map(sample => sample.code).join('\n'), /stopAndDrain\(\): Promise<void>/);
});

test('Queue guide source samples remain synchronized with the shipped files', () => {
	for (const [key, file] of [['writeReportJob', 'WriteReportJob'], ['runQueueReports', 'runQueueReports'], ['reportConsole', 'reportConsole']] as const) {
		const source = readFileSync(new URL(`../../../packages/app/src/queue/examples/${file}.ts`, import.meta.url), 'utf8');
		assert.equal(serviceExampleSources[key], source);
	}
});
