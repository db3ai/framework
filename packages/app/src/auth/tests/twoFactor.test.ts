import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthProvider, AuthToken, AuthTwoFactor, PasswordLoginAttempt, PasswordResetToken, TwoFactorCodeError, TwoFactorRequiredError, UserIdentity, base32Decode, base32Encode, matchTotp, totpCode, totpStep, totpUri } from '@db3.ai/app/auth';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Security } from '@db3.ai/app/security';
import { App } from '@db3.ai/app/server';

const password = 'two-factor-test-password-123';
let database: GeneratedTestDatabase;
let application: App;
let accountNumber = 0;

/** Each test body; the app made last is current, so its security key seals secrets. */
const within = <T>(task: () => Promise<T>) => task;

/** A new account with two-factor sign-in on; returns its secret and recovery codes. */
async function protectedAccount() {
	const email = `two-factor-${++accountNumber}@example.test`;
	const issued = await application.auth.registerWithPassword({ name: 'Two factor', email, password });
	const { secret } = await application.auth.startTwoFactor(issued.user, { issuer: 'db3 test' });
	// The setup code is an older step, so the next sign-in's code (this step) is still fresh.
	const codes = await application.auth.confirmTwoFactor(issued.user, totpCode(secret, totpStep() - 1));
	return { email, user: issued.user, secret, codes };
}

/** Signs in with the password and returns the challenge the second step needs. */
async function challengeFor(email: string) {
	const error = await application.auth.issueTokenForPassword({ email, password }).catch(caught => caught);
	expect(error).toBeInstanceOf(TwoFactorRequiredError);
	return (error as TwoFactorRequiredError).challenge;
}

describe('TOTP codes', () => {
	it('matches the RFC 6238 SHA-1 test vectors', () => {
		const secret = base32Encode(Buffer.from('12345678901234567890'));
		expect(base32Decode(secret).toString()).toBe('12345678901234567890');
		// RFC 6238 appendix B, truncated to six digits.
		expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
		expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
		expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe('279037');
	});

	it('allows one step of drift, and refuses steps already used', () => {
		const secret = base32Encode(Buffer.from('12345678901234567890'));
		const now = 1111111109_000;
		const step = totpStep(now);
		expect(matchTotp(secret, totpCode(secret, step - 1), { now })).toBe(step - 1);
		expect(matchTotp(secret, totpCode(secret, step + 1), { now })).toBe(step + 1);
		expect(matchTotp(secret, totpCode(secret, step - 2), { now })).toBeNull();
		expect(matchTotp(secret, totpCode(secret, step), { now, after: step })).toBeNull();
		expect(matchTotp(secret, 'abcdef', { now })).toBeNull();
		expect(totpUri(secret, { issuer: 'db3 Cloud', account: 'a@b.test' })).toBe(`otpauth://totp/db3%20Cloud%3Aa%40b.test?secret=${secret}&issuer=db3%20Cloud&algorithm=SHA1&digits=6&period=30`);
	});
});

describe('two-factor sign-in', () => {
	beforeAll(async () => {
		database = await createGeneratedTestDatabase('auth_two_factor');
		application = new App({ db: database.db, config: { security: { key: Security.generateKey() } } });
		await application.db.install(UserIdentity, AuthProvider, PasswordLoginAttempt, AuthToken, PasswordResetToken, AuthTwoFactor);
	});

	afterAll(async () => {
		try { await application?.close(); } finally { await database?.destroy(); }
	});

	it('does not apply until setup is confirmed with a code from the app', () => within(async () => {
		const email = `two-factor-${++accountNumber}@example.test`;
		const issued = await application.auth.registerWithPassword({ name: 'Setup', email, password });
		const setup = await application.auth.startTwoFactor(issued.user, { issuer: 'db3 test' });
		expect(setup.uri).toContain(`secret=${setup.secret}`);
		expect(await application.auth.issueTokenForPassword({ email, password })).not.toBeNull();
		await expect(application.auth.confirmTwoFactor(issued.user, '000000')).rejects.toBeInstanceOf(TwoFactorCodeError);
		const codes = await application.auth.confirmTwoFactor(issued.user, totpCode(setup.secret, totpStep()));
		expect(codes).toHaveLength(10);
		expect(await application.auth.twoFactorStatus(issued.user)).toEqual({ enabled: true, recoveryCodesLeft: 10 });
		const stored = await database.db.knex('auth_two_factor').where('user_id', issued.user.id).first();
		expect(stored.secret).not.toContain(setup.secret);
		expect(JSON.stringify(stored.recovery_codes)).not.toContain(codes[0]);
	}));

	it('asks for a code after the password, and the code works once', () => within(async () => {
		const { email, secret } = await protectedAccount();
		const challenge = await challengeFor(email);
		await expect(application.auth.completeTwoFactor(challenge, '123456')).rejects.toBeInstanceOf(TwoFactorCodeError);
		const code = totpCode(secret, totpStep());
		const issued = await application.auth.completeTwoFactor(challenge, code);
		expect(await application.requestContext.run(() => application.auth.authenticateToken(issued.token))).not.toBeNull();
		await expect(application.auth.completeTwoFactor(await challengeFor(email), code)).rejects.toBeInstanceOf(TwoFactorCodeError);
	}));

	it('takes each recovery code once instead of an authenticator code', () => within(async () => {
		const { email, user, codes } = await protectedAccount();
		const recovery = codes[3]!.toUpperCase().replace('-', ' ');
		await application.auth.completeTwoFactor(await challengeFor(email), recovery);
		expect((await application.auth.twoFactorStatus(user)).recoveryCodesLeft).toBe(9);
		await expect(application.auth.completeTwoFactor(await challengeFor(email), codes[3]!)).rejects.toBeInstanceOf(TwoFactorCodeError);
	}));

	it('refuses a challenge that was changed or has expired', () => within(async () => {
		const { email, secret } = await protectedAccount();
		const challenge = await challengeFor(email);
		await expect(application.auth.completeTwoFactor(`${challenge.slice(0, -2)}xx`, totpCode(secret, totpStep()))).rejects.toThrow('expired');
		const expired = application.security.encryptJson({ userId: 'someone', expiresAt: Date.now() - 1 }, { additionalAuthenticatedData: 'auth:two-factor-challenge' });
		await expect(application.auth.completeTwoFactor(expired, totpCode(secret, totpStep()))).rejects.toThrow('expired');
	}));

	it('turns off with a code, and new recovery codes replace the old ones', () => within(async () => {
		const { email, user, secret, codes } = await protectedAccount();
		const fresh = await application.auth.regenerateRecoveryCodes(user, totpCode(secret, totpStep()));
		await expect(application.auth.disableTwoFactor(user, codes[0]!)).rejects.toBeInstanceOf(TwoFactorCodeError);
		await application.auth.disableTwoFactor(user, fresh[0]!);
		expect(await application.auth.twoFactorStatus(user)).toEqual({ enabled: false, recoveryCodesLeft: 0 });
		expect(await application.auth.issueTokenForPassword({ email, password })).not.toBeNull();
	}));
});
