import assert from 'node:assert/strict';
import test from 'node:test';
import { findArticle, navigationGroups, searchDocumentation } from '../src/docs';
import { documentationArticleMarkdown, llmsText } from '../src/documentationMarkdown';
import { serviceExampleSources } from '../src/generated/service-examples';

const tutorialNames = ['kanban', 'presence', 'actions', 'jobs', 'chat', 'deployments', 'yjs', 'ai', 'approvals', 'uploads', 'inventory', 'permissions'];

/** Guards the shared connection, authorization, worker publication and recovery contract. */
test('main WebSocket guide teaches the transport and links all focused tutorials', () => {
	const article = findArticle('websocket')!;
	for (const id of ['setup', 'mount', 'browser', 'publish', 'workers', 'recovery', 'resource-channels', 'limits', 'tutorials', 'testing']) assert.ok(article.sections.some(section => section.id === id), id);
	const body = article.sections.flatMap(section => section.paragraphs).join('\n');
	for (const phrase of ['one `WebSocketClient` per browser tab', 'No Redis service is required for one active API', 'every subscription and delivery', 'onSubscribed', 'no durable replay', '4403']) assert.ok(body.includes(phrase), phrase);
	assert.equal(article.codeSamples?.find(sample => sample.id === 'endpoint')?.code, serviceExampleSources.resourceChannels);
	const links = article.sections.find(section => section.id === 'tutorials')!.links!;
	assert.deepEqual(links.map(link => link.articleId).sort(), tutorialNames.map(name => `realtime-${name}`).sort());
	const code = findArticle('websocket-api')!.codeSamples!.map(sample => sample.code).join('\n');
	for (const api of ['defineWebSocket', 'registerWebSockets', 'WebSocketChannels', 'defineChannel', 'WebSocketChannelDefinition']) assert.ok(code.includes(api), api);
});

/** Keeps every walkthrough independently navigable, searchable and available to Markdown consumers. */
test('all twelve realtime tutorials are registered with steps, evidence and recovery guidance', () => {
	const group = navigationGroups('cookbook').find(group => group.title === 'Realtime tutorials')!;
	assert.deepEqual(group.articles.map(article => article.id).sort(), tutorialNames.map(name => `realtime-${name}`).sort());
	for (const article of group.articles) {
		assert.ok(article.sections.some(section => section.id === 'setup'), article.id);
		assert.ok(article.sections.some(section => section.id === 'testing'), article.id);
		assert.ok(article.sections.length >= 6, article.id);
		if (['kanban', 'presence', 'actions', 'jobs', 'chat', 'deployments', 'permissions'].some(name => article.id === `realtime-${name}`)) assert.ok(article.testPath, article.id);
		assert.ok(searchDocumentation(article.title).some(result => result.id === article.id), article.id);
		const markdown = documentationArticleMarkdown(article);
		assert.ok(markdown.includes(article.title), article.id);
		assert.match(markdown, /reconnect|reload|recover/i, article.id);
		assert.ok(llmsText().includes(`/docs/${article.id}`), article.id);
	}
});

/** Ensures copyable model, Pinia and deployment code is the exact implementation exercised by tests. */
test('Kanban and deployment tutorials use executable sources and distinguish their test coverage', () => {
	const board = findArticle('realtime-kanban')!;
	for (const [id, key] of Object.entries({ 'board-snapshot': 'boardSnapshot', 'live-board': 'liveBoard', 'board-routes': 'registerBoardRoutes', 'board-store': 'createBoardStore', 'channel-sync': 'createChannelSync', 'board-client': 'createBoardClient', 'board-job': 'summarizeBoardJob' })) {
		assert.equal(board.codeSamples?.find(sample => sample.id === id)?.code, serviceExampleSources[key as keyof typeof serviceExampleSources]);
	}
	const deployment = findArticle('realtime-deployments')!;
	assert.equal(deployment.codeSamples?.find(sample => sample.id === 'deployment-snapshot')?.code, serviceExampleSources.deploymentSnapshot);
	assert.equal(deployment.codeSamples?.find(sample => sample.id === 'deployment-endpoint')?.code, serviceExampleSources.deploymentEndpoint);
	const body = documentationArticleMarkdown(deployment);
	for (const phrase of ['Cloud deployment orchestration is still proposed', 'end-to-end check after traffic switches', 'environment isolation and revoked subscriptions', 'do not deploy a machine']) assert.ok(body.includes(phrase), phrase);
});

/** Prevents integration designs from being mistaken for shipped Yjs or durable AI replay adapters. */
test('Yjs and AI tutorials state the missing integration and replay boundaries', () => {
	const yjs = documentationArticleMarkdown(findArticle('realtime-yjs')!);
	const ai = documentationArticleMarkdown(findArticle('realtime-ai')!);
	assert.match(yjs, /cannot connect.*unchanged/);
	assert.match(ai, /no-op sink/);
	assert.match(ai, /integration work, not existing framework endpoints/);
	for (const id of ['realtime-ai', 'realtime-yjs']) assert.equal(findArticle(id)!.verifiedExample, undefined);
});
