import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { App } from '@db3.ai/app';

/** App roots normalize paths and file URLs before lazy services need them. */
it.each([undefined, './example app', pathToFileURL(resolve('example app'))])('captures an absolute application directory from %s', async directory => {
	const application = new App({ directory });
	try { expect(application.directory).toBe(resolve(directory === undefined ? '.' : 'example app')); }
	finally { await application.close(); }
});
