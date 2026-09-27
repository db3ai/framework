import { expect, it } from 'vitest';
import { runGuardedFetch } from '../../examples/runGuardedFetch';

it('blocks a private receiver by default and reaches it only when explicitly allowed', async () => {
	await expect(runGuardedFetch()).resolves.toEqual({
		privateBlockedByDefault: true,
		privateAllowedWhenRequested: true,
	});
});
