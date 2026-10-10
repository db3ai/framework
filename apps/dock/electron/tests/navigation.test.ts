import assert from 'node:assert/strict';
import { test } from 'node:test';

import { externalUrl, isDockNavigation, isLoopbackHttpUrl } from '../src/navigation.js';

test('keeps Dock navigation in the window', () => {
	assert.equal(isDockNavigation('http://127.0.0.1:8790/', 'http://127.0.0.1:8790'), true);
	assert.equal(isDockNavigation('http://localhost:5173/', 'http://127.0.0.1:8790'), false);
	assert.equal(isDockNavigation('not a url', 'http://127.0.0.1:8790'), false);
});

test('opens only http(s) links externally', () => {
	assert.equal(externalUrl('http://localhost:5173/'), 'http://localhost:5173/');
	assert.equal(externalUrl('https://db3.ai'), 'https://db3.ai/');
	assert.equal(externalUrl('file:///etc/passwd'), null);
	assert.equal(externalUrl('javascript:alert(1)'), null);
});

test('accepts only local UI addresses from the launcher', () => {
	assert.equal(isLoopbackHttpUrl('http://127.0.0.1:5179'), true);
	assert.equal(isLoopbackHttpUrl('http://dock.localhost:8790'), true);
	assert.equal(isLoopbackHttpUrl('https://evil.example'), false);
	assert.equal(isLoopbackHttpUrl('file:///tmp/x.html'), false);
});
