import { expect, it, vi } from 'vitest';
import { UrlGenerator } from '@db3.ai/app/url';
import { applicationLink, runApplicationLinks } from '../../examples/runApplicationLinks';

it('resolves trusted canonical links and repairs invalid configuration', async () => {
	expect(await runApplicationLinks()).toEqual({ base: 'https://notes.example.test/workspace', relative: 'https://notes.example.test/workspace/notes/one', root: 'https://notes.example.test/notes/one', externalRejected: true, invalidBaseRejected: true, repaired: 'https://notes.example.test/sign-in' });
	const url = new UrlGenerator({ baseUrl: 'https://notes.example.test' });
	for (const path of ['https://outside.example.test', '//outside.example.test', '/\\outside.example.test', 'javascript:alert(1)']) expect(() => applicationLink(url, path)).toThrow();
});

it('requires configuration and checks local ports when environment fallbacks are absent', () => {
	vi.stubEnv('APP_URL', ''); vi.stubEnv('PUBLIC_APP_URL', '');
	try {
		expect(() => new UrlGenerator()).toThrow('not configured');
		expect(() => new UrlGenerator({ localPort: 0 })).toThrow('local port');
		expect(new UrlGenerator({ localPort: 8717 }).baseUrl).toBe('http://localhost:8717');
	} finally { vi.unstubAllEnvs(); }
});
