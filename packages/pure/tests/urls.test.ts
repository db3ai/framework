import { describe, expect, it } from 'vitest';
import { normalizeUrl, tryNormalizeUrl } from '../src/urls';

describe('URL helpers', () => {
	it('normalizes bare domains and removes hashes', () => {
		expect(normalizeUrl('newicon.net')).toBe('https://newicon.net/');
		expect(normalizeUrl('newicon.net/about#team')).toBe('https://newicon.net/about');
	});

	it('collapses repeated path slashes while preserving a single trailing slash', () => {
		expect(normalizeUrl('https://newicon.net///////')).toBe('https://newicon.net/');
		expect(normalizeUrl('newicon.net//another')).toBe('https://newicon.net/another');
		expect(normalizeUrl(normalizeUrl('newicon.net//another'))).toBe('https://newicon.net/another');
		expect(normalizeUrl('https://newicon.net/another/')).toBe('https://newicon.net/another/');
		expect(normalizeUrl('https://newicon.net/another////')).toBe('https://newicon.net/another/');
	});

	it('collapses repeated path slashes after resolving against a base URL', () => {
		expect(tryNormalizeUrl('/pricing//plans#top', 'https://newicon.net')).toBe('https://newicon.net/pricing/plans');
		expect(tryNormalizeUrl('https://newicon.net///////?redirect=//keep')).toBe('https://newicon.net/?redirect=//keep');
	});
});
