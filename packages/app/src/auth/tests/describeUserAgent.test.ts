import { describe, expect, it } from 'vitest';
import { describeUserAgent, requestLocation, sessionLabel } from '../describeUserAgent';

describe('describeUserAgent', () => {
	it('names the browser, system and device people recognise', () => {
		expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari', operatingSystem: 'iOS', device: 'iPhone' });
		expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toEqual({ browser: 'Chrome', operatingSystem: 'macOS', device: 'Computer' });
		expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toEqual({ browser: 'Edge', operatingSystem: 'Windows', device: 'Computer' });
		expect(describeUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')).toEqual({ browser: 'Chrome', operatingSystem: 'Android', device: 'Phone' });
	});

	it('leaves what it cannot tell as null', () => {
		expect(describeUserAgent('curl/8.7.1')).toEqual({ browser: null, operatingSystem: null, device: null });
		expect(describeUserAgent(undefined)).toEqual({ browser: null, operatingSystem: null, device: null });
	});
});

describe('sessionLabel', () => {
	it('reads like an account device list', () => {
		expect(sessionLabel({ browser: 'Chrome', operatingSystem: 'macOS', device: 'Computer' })).toBe('Chrome (macOS)');
		expect(sessionLabel({ name: 'db3 CLI', browser: null, operatingSystem: 'Linux', device: null })).toBe('db3 CLI (Linux)');
		expect(sessionLabel({ browser: null, operatingSystem: null, device: null })).toBe('Unknown device');
	});
});

describe('requestLocation', () => {
	it('joins the Cloudflare location headers', () => {
		expect(requestLocation({ 'cf-ipcity': 'Bristol', 'cf-region': 'England', 'cf-ipcountry': 'GB' })).toBe('Bristol, England, GB');
		expect(requestLocation({ 'cf-ipcity': 'S%C3%A3o%20Paulo', 'cf-ipcountry': 'BR' })).toBe('São Paulo, BR');
	});

	it('is null when Cloudflare said nothing useful', () => {
		expect(requestLocation({})).toBeNull();
		expect(requestLocation({ 'cf-ipcountry': 'XX' })).toBeNull();
	});
});
