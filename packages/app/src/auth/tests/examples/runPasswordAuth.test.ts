import { expect, it } from 'vitest';
import { runPasswordAuth } from '../../examples/runPasswordAuth';

it('runs registration, login, reset and revocation using real SQL and password hashing', async () => {
	expect(await runPasswordAuth()).toEqual({
		authenticated: true, signedIn: true, wrongPasswordRejected: true, allDevicesRevoked: true,
		passwordChanged: true, usedResetRejected: true, oldPasswordRejected: true,
		revokedTokenRejected: true,
	});
});
