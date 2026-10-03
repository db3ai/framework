import assert from 'node:assert/strict';
import test from 'node:test';
import { browserDocumentationLocation, documentationPath, LANDING_PATH, parseDocumentationRoute } from '../client/siteRoutes';

test('the framework path is the canonical framework homepage', () => {
	assert.equal(LANDING_PATH, '/framework');
	assert.deepEqual(parseDocumentationRoute('/framework'), {
		kind: 'landing',
		pathname: '/framework',
		articleId: '',
		sectionId: '',
	});
	assert.equal(documentationPath('welcome'), '/framework/docs/welcome');
});

test('documentation paths preserve encoded article and section identifiers', () => {
	assert.deepEqual(parseDocumentationRoute('/framework/docs/queue-overview#creating-jobs'), {
		kind: 'article',
		pathname: '/framework/docs/queue-overview',
		articleId: 'queue-overview',
		sectionId: 'creating-jobs',
	});
	assert.deepEqual(parseDocumentationRoute('https://db3.ai/framework/docs/package%2Fname/?source=ai#public%20api'), {
		kind: 'article',
		pathname: '/framework/docs/package%2Fname',
		articleId: 'package/name',
		sectionId: 'public api',
	});
	assert.equal(documentationPath('package/name', 'public api'), '/framework/docs/package%2Fname#public%20api');
});

test('unsupported and incomplete paths resolve to the rendered not-found boundary', () => {
	assert.equal(parseDocumentationRoute('/framework/docs').kind, 'not-found');
	assert.equal(parseDocumentationRoute('/framework/docs/').kind, 'not-found');
	assert.equal(parseDocumentationRoute('/framework/docs/queue/worker').kind, 'not-found');
	assert.equal(parseDocumentationRoute('/api/private').kind, 'not-found');
});

test('browser locations retain query and fragment state for history navigation', () => {
	assert.equal(browserDocumentationLocation({
		pathname: '/framework/docs/queue-overview',
		search: '?source=search',
		hash: '#failures',
	}), '/framework/docs/queue-overview?source=search#failures');
});

/** Verifies the framework has its own canonical landing route within the framework namespace. */
test('framework landing routes retain section navigation and normalize trailing slashes', () => {
	assert.deepEqual(parseDocumentationRoute('/framework/#capabilities-title'), {
		kind: 'landing',
		pathname: '/framework',
		articleId: '',
		sectionId: 'capabilities-title',
	});
});
