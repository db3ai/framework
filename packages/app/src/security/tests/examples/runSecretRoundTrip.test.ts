import { expect, it } from 'vitest';
import { Security, SecurityError } from '@db3.ai/app/security';
import { App } from '@db3.ai/app/server';
import { runSecretRoundTrip } from '../../examples/runSecretRoundTrip';

it('round trips a secret without exposing it and rejects tampering, changed context and non-JSON values', async () => {
	const output = await runSecretRoundTrip();
	expect(output).toEqual({ roundTrip: true, randomized: true, contextRejected: true, tamperingRejected: true, nonJsonRejected: true });
	expect(JSON.stringify(output)).not.toContain('example-secret');
});

it('rejects a different key and recovers with the original service key', async () => {
	const original = new App({ config: { security: { key: Security.generateKey() } }, dbOptions: { syncColumns: false } });
	const security = original.security;
	const encrypted = security.encrypt('test-secret');
	const different = new App({ config: { security: { key: Security.generateKey() } }, dbOptions: { syncColumns: false } });
	try {
		expect(() => different.security.decrypt(encrypted)).toThrow(SecurityError);
		expect(security.decrypt(encrypted).toString()).toBe('test-secret');
	} finally {
		await different.close();
		await original.close();
	}
});
