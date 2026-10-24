import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from '../src/http';

describe('safeRedirectPath', () => {
	it.each(['/app/dashboard', '/app?tab=one#detail', '/article/words with spaces'])('preserves a local path %s', path => {
		expect(safeRedirectPath(path)).toBe(path);
	});

	it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/\t/evil.test', '/\n/evil.test', '/\r/evil.test', '/app\u0000'])('rejects browser-normalized external or control forms %j', path => {
		expect(safeRedirectPath(path)).toBeNull();
	});

	it('applies excluded prefixes after dot-segment normalization', () => {
		expect(safeRedirectPath('/app/../auth/reset', ['/auth/'])).toBeNull();
		expect(safeRedirectPath('/app/%2e%2e/auth/reset', ['/auth/'])).toBeNull();
		expect(safeRedirectPath('/app/dashboard', ['/auth/'])).toBe('/app/dashboard');
	});
});
