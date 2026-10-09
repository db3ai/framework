import assert from 'node:assert/strict';
import test from 'node:test';
import { externalWebUrl, isAppNavigation, resolveAppUrl } from '../src/navigationPolicy.js';

/** Verifies that hosted builds and development URLs retain a concrete trusted origin. */
test('accepts HTTPS and explicitly enabled loopback development only', () => {
	assert.equal(resolveAppUrl('https://starter.example/app', false), 'https://starter.example/app');
	for (const host of ['localhost', '127.0.0.1', '[::1]']) {
		assert.equal(resolveAppUrl(`http://${host}:5173`, true), `http://${host}:5173/`);
		assert.throws(() => resolveAppUrl(`http://${host}:5173`, false));
	}
	for (const url of ['http://example.com', 'http://localhost.example.com', 'file:///tmp/index.html', 'javascript:alert(1)', 'https://user:password@example.com', 'invalid']) {
		assert.throws(() => resolveAppUrl(url, true));
	}
});

/** Checks exact-origin boundaries, including deceptive hosts, ports and embedded credentials. */
test('keeps only same-origin navigation in the desktop window', () => {
	const origin = 'https://starter.example';
	assert.equal(isAppNavigation(`${origin}/notes?id=1#edit`, origin), true);
	for (const url of ['https://starter.example.attacker.test', 'https://starter.example:8443', 'http://starter.example', 'https://user@starter.example', 'data:text/html,hello', 'invalid']) {
		assert.equal(isAppNavigation(url, origin), false);
	}
});

/** Prevents web content passing executable, file or custom schemes to the operating system. */
test('external links permit ordinary web URLs only', () => {
	assert.equal(externalWebUrl('https://db3.ai/docs'), 'https://db3.ai/docs');
	assert.equal(externalWebUrl('http://localhost:5173'), 'http://localhost:5173/');
	for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello', 'mailto:user@example.com', 'db3-starter-retry:', 'https://user:password@example.com', 'invalid']) {
		assert.equal(externalWebUrl(url), null);
	}
});
