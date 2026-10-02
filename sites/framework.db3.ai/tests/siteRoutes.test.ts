import assert from 'node:assert/strict';
import test from 'node:test';
import { browserDocumentationLocation, documentationPath, LANDING_PATH, parseDocumentationRoute } from '../src/siteRoutes';

test('the root path is the canonical company homepage', () => {
	assert.equal(LANDING_PATH, '/');
	assert.deepEqual(parseDocumentationRoute('/'), {
		kind: 'landing',
		pathname: '/',
		articleId: '',
		sectionId: '',
	});
	assert.equal(documentationPath('welcome'), '/docs/welcome');
});

test('documentation paths preserve encoded article and section identifiers', () => {
	assert.deepEqual(parseDocumentationRoute('/docs/queue-overview#creating-jobs'), {
		kind: 'article',
		pathname: '/docs/queue-overview',
		articleId: 'queue-overview',
		sectionId: 'creating-jobs',
	});
	assert.deepEqual(parseDocumentationRoute('https://framework.db3.ai/docs/package%2Fname/?source=ai#public%20api'), {
		kind: 'article',
		pathname: '/docs/package%2Fname',
		articleId: 'package/name',
		sectionId: 'public api',
	});
	assert.equal(documentationPath('package/name', 'public api'), '/docs/package%2Fname#public%20api');
});

test('unsupported and incomplete paths resolve to the rendered not-found boundary', () => {
	assert.equal(parseDocumentationRoute('/docs').kind, 'not-found');
	assert.equal(parseDocumentationRoute('/docs/').kind, 'not-found');
	assert.equal(parseDocumentationRoute('/docs/queue/worker').kind, 'not-found');
	assert.equal(parseDocumentationRoute('/api/private').kind, 'not-found');
});

test('browser locations retain query and fragment state for history navigation', () => {
	assert.equal(browserDocumentationLocation({
		pathname: '/docs/queue-overview',
		search: '?source=search',
		hash: '#failures',
	}), '/docs/queue-overview?source=search#failures');
});

/** Verifies the framework has its own canonical landing route without moving documentation URLs. */
test('framework landing routes retain section navigation and normalize trailing slashes', () => {
	assert.deepEqual(parseDocumentationRoute('/framework/#capabilities-title'), {
		kind: 'framework',
		pathname: '/framework',
		articleId: '',
		sectionId: 'capabilities-title',
	});
});
