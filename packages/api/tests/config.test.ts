import { describe, expect, it } from 'vitest';
import { DEFAULT_API_CONFIG, accessFor, parseApiConfig } from '../src';

describe('db3/api.json', () => {
	it('is off when the file does not exist', () => {
		expect(parseApiConfig(undefined)).toEqual(DEFAULT_API_CONFIG);
		expect(accessFor(parseApiConfig(undefined), 'agents', 'triage', 'run')).toBe('off');
	});

	it('fills closed defaults for missing values', () => {
		expect(parseApiConfig({})).toEqual({ enabled: false, origins: [], rateLimit: { perMinute: 600 }, services: {} });
	});

	it('keeps every route off while the master switch is off', () => {
		const config = parseApiConfig({ enabled: false, services: { agents: { 'triage.run': 'publishable' } } });
		expect(accessFor(config, 'agents', 'triage', 'run')).toBe('off');
	});

	it('opens only the routes it lists', () => {
		const config = parseApiConfig({ enabled: true, services: { agents: { 'triage.run': 'user' } } });
		expect(accessFor(config, 'agents', 'triage', 'run')).toBe('user');
		expect(accessFor(config, 'agents', 'billing', 'run')).toBe('off');
		expect(accessFor(config, 'flows', 'lead-intake', 'start')).toBe('off');
	});

	it('refuses a bad file instead of guessing', () => {
		expect(() => parseApiConfig({ enabled: true, services: { agents: { 'triage.run': 'everyone' } } })).toThrow();
		expect(() => parseApiConfig({ enabled: true, origins: ['https://example.com/path'] })).toThrow();
		expect(() => parseApiConfig({ enabled: true, public: true })).toThrow();
		expect(() => parseApiConfig({ services: { agents: { triage: 'user' } } })).toThrow();
	});
});
