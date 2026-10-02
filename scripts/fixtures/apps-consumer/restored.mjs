import assert from 'node:assert/strict';
import { App } from '@db3.ai/app';

const host = new App();
try {
	await host.apps.install('social');
	await host.apps.boot();
	const entries = await host.social.list('01ARZ3NDEKTSV4RRFFQ69G5FAV');
	assert.equal(entries.length, 1);
	assert.equal(entries[0].title, 'Packaged app proof');
	assert.equal((await host.apps.migrations('social').check()).matches, true);
} finally { await host.close(); }
