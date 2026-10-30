import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../server/config';

beforeEach(() => {
	for (const name of ['APP_ADMIN_EMAIL', 'APPS_MANAGE_ONLINE', 'NODE_ENV', 'APP_ORIGIN', 'APP_NAME', 'PORT', 'HOST', 'GOOGLE_AUTH_CLIENT_ID', 'OPENAI_API_KEY', 'OPENAI_MODEL']) vi.stubEnv(name, undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('Starter server configuration', () => {
	it('uses deterministic local defaults without provider credentials', () => {
		expect(readConfig()).toEqual({ name: 'My DB3 app', origin: 'http://localhost:5173', production: false, appsAdminEmail: undefined, appsManageOnline: true, port: 3001, host: '127.0.0.1', auth: { googleClientId: '' }, ai: { apiKey: '', model: 'gpt-4.1-mini' } });
	});

	it('reads explicitly configured server settings and trims the provider key', () => {
		for (const [name, value] of Object.entries({ NODE_ENV: 'production', APP_ORIGIN: 'https://example.com', APP_NAME: 'Example', PORT: '4000', HOST: '0.0.0.0', GOOGLE_AUTH_CLIENT_ID: 'test-client', OPENAI_API_KEY: ' test-key ', OPENAI_MODEL: 'test-model' })) vi.stubEnv(name, value);
		expect(readConfig()).toEqual({ name: 'Example', origin: 'https://example.com', production: true, appsAdminEmail: undefined, appsManageOnline: false, port: 4000, host: '0.0.0.0', auth: { googleClientId: 'test-client' }, ai: { apiKey: 'test-key', model: 'test-model' } });
	});

	it('rejects insecure production origins while allowing local HTTP development', () => {
		vi.stubEnv('APP_ORIGIN', 'http://localhost:5173');
		expect(readConfig().production).toBe(false);
		vi.stubEnv('NODE_ENV', 'production');
		expect(() => readConfig()).toThrow('production requires HTTPS');
	});

	it('rejects URLs that are not exact origins', () => {
		const credentialUrl = new URL('https://example.com');
		credentialUrl.username = 'test-user';
		credentialUrl.password = 'test-password';
		for (const origin of ['not a URL', 'https://example.com/', 'https://example.com/path', 'https://example.com?query=1', 'https://example.com#fragment', credentialUrl.href]) {
			vi.stubEnv('APP_ORIGIN', origin);
			expect(() => readConfig()).toThrow();
		}
	});

	it('falls back from empty environment settings and whitespace-only keys', () => {
		for (const name of ['APP_ORIGIN', 'APP_NAME', 'PORT', 'HOST', 'GOOGLE_AUTH_CLIENT_ID', 'OPENAI_MODEL']) vi.stubEnv(name, '');
		vi.stubEnv('OPENAI_API_KEY', '  ');
		expect(readConfig()).toMatchObject({ name: 'My DB3 app', origin: 'http://localhost:5173', port: 3001, host: '127.0.0.1', auth: { googleClientId: '' }, ai: { apiKey: '', model: 'gpt-4.1-mini' } });
	});
});


it('normalizes the administrator identity and requires explicit production online-management opt-in', () => {
	vi.stubEnv('APP_ADMIN_EMAIL', ' Admin@Example.test ');
	vi.stubEnv('APPS_MANAGE_ONLINE', 'false');
	expect(readConfig()).toMatchObject({ appsAdminEmail: 'admin@example.test', appsManageOnline: false });
	vi.stubEnv('NODE_ENV', 'production');
	vi.stubEnv('APP_ORIGIN', 'https://example.test');
	vi.stubEnv('APPS_MANAGE_ONLINE', 'true');
	expect(readConfig().appsManageOnline).toBe(true);
});
