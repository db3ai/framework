import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureAppKey, Security, SecurityError } from '..';
import { App, clearActiveApp } from '../../server';

const TEST_KEY = '0123456789abcdef0123456789abcdef';
const OTHER_TEST_KEY = 'fedcba9876543210fedcba9876543210';
const originalAppKey = process.env.APP_KEY;
const originalWorkingDirectory = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(async () => {
	process.chdir(originalWorkingDirectory);
	clearActiveApp();
	restoreAppKey();

	await Promise.all(temporaryDirectories.splice(0).map(directory => {
		return rm(directory, {
			recursive: true,
			force: true,
		});
	}));
});

describe('Security', () => {
	it('encrypts and decrypts bytes with randomized authenticated payloads', () => {
		const security = configuredSecurity();
		const first = security.encrypt('provider-secret', {
			additionalAuthenticatedData: 'website:integration',
		});
		const second = security.encrypt('provider-secret', {
			additionalAuthenticatedData: 'website:integration',
		});

		expect(first).toMatch(/^security:1:aes-256-gcm:/);
		expect(first).not.toContain('provider-secret');
		expect(second).not.toBe(first);
		expect(security.decrypt(first, {
			additionalAuthenticatedData: 'website:integration',
		}).toString('utf8')).toBe('provider-secret');
	});

	it('round trips empty plaintext', () => {
		const security = configuredSecurity();
		const encrypted = security.encrypt('');

		expect(security.decrypt(encrypted).toString('utf8')).toBe('');
	});

	it('encrypts and decrypts JSON values through the configured app service', () => {
		const application = configuredApp();
		const value = {
			token: 'provider-secret',
			scopes: ['posts:write'],
		};
		const encrypted = application.security.encryptJson(value);

		expect(application.security).toBe(application.security);
		expect(application.security.decryptJson(encrypted)).toEqual(value);
	});

	it('rejects the wrong key, changed context, and malformed payloads', () => {
		const security = configuredSecurity();
		const encrypted = security.encrypt('provider-secret', {
			additionalAuthenticatedData: 'website:integration',
		});
		const wrongKeySecurity = configuredSecurity(OTHER_TEST_KEY);

		expect(() => wrongKeySecurity.decrypt(encrypted, {
			additionalAuthenticatedData: 'website:integration',
		})).toThrow(SecurityError);
		expect(() => security.decrypt(encrypted, {
			additionalAuthenticatedData: 'website:different-field',
		})).toThrow(SecurityError);
		expect(() => security.decrypt('not-an-encrypted-payload')).toThrow(
			'Encrypted payload has an unsupported or malformed format',
		);
	});

	it('requires configured key material during app startup', () => {
		expect(() => new App({
			config: {
				security: {},
			},
		})).toThrow('Application security requires a configured 32-byte key');

		expect(() => configuredApp('too-short')).toThrow(
			'Application security key must contain exactly 32 bytes',
		);
	});

	it('pins the configured key for the application lifetime', () => {
		const security = configuredSecurity();
		const encrypted = security.encrypt('provider-secret');

		configuredApp(OTHER_TEST_KEY);

		expect(security.decrypt(encrypted).toString('utf8')).toBe('provider-secret');
	});

	it('generates base64-formatted 256-bit application keys', () => {
		const generated = Security.generateKey();
		const decoded = Buffer.from(generated.replace(/^base64:/, ''), 'base64');

		expect(generated).toMatch(/^base64:/);
		expect(decoded).toHaveLength(32);
	});

	it('creates the conventional .env file when APP_KEY is missing', async () => {
		delete process.env.APP_KEY;

		const directory = await temporaryDirectory();

		process.chdir(directory);

		const generated = ensureAppKey();
		const content = await readFile(join(directory, '.env'), 'utf8');

		expect(generated).toMatch(/^base64:/);
		expect(process.env.APP_KEY).toBe(generated);
		expect(parse(content).APP_KEY).toBe(generated);
	});

	it('replaces a blank APP_KEY while preserving other .env values', async () => {
		delete process.env.APP_KEY;

		const directory = await temporaryDirectory();
		const environmentFile = join(directory, '.env');

		await writeFile(environmentFile, [
			'APP_NAME=Platform',
			'APP_KEY=',
			'OTHER_VALUE=preserved',
			'',
		].join('\n'), {
			encoding: 'utf8',
			mode: 0o600,
		});
		process.chdir(directory);

		const generated = ensureAppKey();
		const content = await readFile(environmentFile, 'utf8');

		expect(parse(content).APP_KEY).toBe(generated);
		expect(content).toContain('APP_NAME=Platform');
		expect(content).toContain('OTHER_VALUE=preserved');
	});

	it('preserves an existing APP_KEY from .env for normal validation', async () => {
		delete process.env.APP_KEY;

		const directory = await temporaryDirectory();
		const environmentFile = join(directory, '.env');

		await writeFile(environmentFile, 'APP_KEY=invalid\n', {
			encoding: 'utf8',
			mode: 0o600,
		});
		process.chdir(directory);

		expect(ensureAppKey()).toBe('invalid');
		expect(await readFile(environmentFile, 'utf8')).toBe('APP_KEY=invalid\n');
		expect(() => configuredApp(process.env.APP_KEY)).toThrow(
			'Application security key must contain exactly 32 bytes',
		);
	});

	it('fails when the conventional .env file cannot be updated', async () => {
		delete process.env.APP_KEY;

		const directory = await temporaryDirectory();

		await mkdir(join(directory, '.env'));
		process.chdir(directory);

		expect(() => ensureAppKey()).toThrow(
			'Application security could not persist APP_KEY to ".env"',
		);
		expect(process.env.APP_KEY).toBeUndefined();
	});

	it('rejects decrypted text that is not valid JSON', () => {
		const security = configuredSecurity();
		const encrypted = security.encrypt('not-json');

		expect(() => security.decryptJson(encrypted)).toThrow(
			'Decrypted security payload does not contain valid JSON',
		);
	});
});

/**
 * Creates an app with conventional security configuration.
 *
 * @param key - Encryption key supplied through the app config boundary.
 * @returns Configured application instance.
 */
function configuredApp(key: string | undefined = TEST_KEY): App {
	return new App({
		config: {
			security: {
				key,
				cipher: 'aes-256-gcm',
			},
		},
	});
}

/**
 * Returns the security service owned by a configured app.
 *
 * @param key - Encryption key supplied through the app config boundary.
 * @returns Configured security service.
 */
function configuredSecurity(key: string = TEST_KEY): Security {
	return configuredApp(key).security;
}

/**
 * Restores the process APP_KEY captured before this test module.
 *
 * @returns {void}
 */
function restoreAppKey(): void {
	if (originalAppKey === undefined) {
		delete process.env.APP_KEY;
		return;
	}

	process.env.APP_KEY = originalAppKey;
}

/**
 * Creates a disposable directory for environment-file tests.
 *
 * @returns Absolute temporary directory path.
 */
async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'platform-security-'));

	temporaryDirectories.push(directory);

	return directory;
}
