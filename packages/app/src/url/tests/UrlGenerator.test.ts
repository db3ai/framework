import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, clearActiveApp } from '../../server';
import { UrlGenerator } from '..';

afterEach(() => {
	vi.unstubAllEnvs();
	clearActiveApp();
});

describe('UrlGenerator', () => {
	it('normalizes one explicit application base URL', () => {
		const url = new UrlGenerator({
			baseUrl: 'https://example.com/',
		});

		expect(url.baseUrl).toBe('https://example.com');
		expect(url.to('/api/oauth/callback')).toBe('https://example.com/api/oauth/callback');
	});

	it('resolves a local application URL from the configured browser port', () => {
		vi.stubEnv('APP_URL', '');
		vi.stubEnv('PUBLIC_APP_URL', '');

		const url = new UrlGenerator({
			localPort: 8888,
		});

		expect(url.baseUrl).toBe('http://localhost:8888');
	});

	it('is exposed as one shared application service', () => {
		const application = new App({
			url: {
				baseUrl: 'https://scout.example.test/',
			},
		});

		expect(application.url).toBe(application.url);
		expect(application.url.baseUrl).toBe('https://scout.example.test');
	});

	it('rejects an application without a public URL or local port', () => {
		vi.stubEnv('APP_URL', '');
		vi.stubEnv('PUBLIC_APP_URL', '');

		expect(() => new UrlGenerator()).toThrow('Application base URL is not configured.');
	});
});
