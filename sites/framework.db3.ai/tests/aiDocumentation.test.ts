import assert from 'node:assert/strict';
import test from 'node:test';
import { docAreas, documentationCommands, findArticle, navigationGroups } from '../src/docs';
import { guideNavigation, landingCapabilities } from '../src/landing';

test('AI is a primary documentation area reachable from the website and search', () => {
	assert.ok(docAreas.some(area => area.id === 'ai' && area.label === 'AI'));
	assert.equal(findArticle('ai')?.area, 'ai');
	assert.ok(navigationGroups('ai').flatMap(group => group.articles).some(article => article.id === 'ai'));
	assert.equal(navigationGroups('services').flatMap(group => group.articles).some(article => article.id === 'ai'), false);
	assert.match(documentationCommands().find(command => command.value === 'ai')?.description ?? '', /^AI ·/);
	assert.ok(guideNavigation.some(item => item.value === 'ai'));
	assert.ok(landingCapabilities.some(item => item.target === 'ai'));
});

test('new applications start with the creator and standalone HTTP remains a separate path', () => {
	assert.equal(findArticle('starter-app')?.label, 'Create an app');
	assert.equal(findArticle('create-app')?.group, 'Standalone use');
	assert.equal(guideNavigation[0].value, 'starter-app');
});


test('AI guides describe implemented app workflows and remove the old text-only API', () => {
	for (const id of ['ai-agents', 'ai-conversations', 'ai-images', 'ai-embeddings', 'ai-usage', 'ai-providers']) {
		const article = findArticle(id);
		assert.equal(article?.area, 'ai');
		assert.equal(article?.testPath, 'packages/app/src/ai/tests/Ai.integration.test.ts');
	}
	const prose = JSON.stringify(navigationGroups('ai'));
	assert.doesNotMatch(prose, /OpenAIText|TextGenerationError|stateless server-side text client/);
	assert.match(prose, /tool.success/);
	assert.match(prose, /runCostSummary/);
	assert.match(prose, /AiConversation/);
	assert.match(prose, /before the SDK has emitted/);
});
