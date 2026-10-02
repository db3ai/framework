import assert from 'node:assert/strict';
import { App } from '@db3.ai/app';

await assert.rejects(import('@db3.ai/social'), { code: 'ERR_MODULE_NOT_FOUND' });
const host = new App();
try {
	await host.apps.boot();
	assert.equal((await host.apps.describe())[0].registered, false);
	assert.equal((await host.apps.describe())[0].state, 'uninstalled');
	assert.equal((await host.db.knex('social_opportunities')).length, 1);
} finally { await host.close(); }
