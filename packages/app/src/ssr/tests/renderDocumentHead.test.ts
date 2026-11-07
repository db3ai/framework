import { expect, it } from 'vitest';
import { renderDocumentHead } from '../renderDocumentHead';

it('rejects structural and event-handler attribute injection while retaining valid head attributes', () => {
	const html = renderDocumentHead({
		title: 'Safe <title>',
		meta: [{ name: 'description', content: 'Safe "text"', '"><script src=https://evil.test></script>': true }],
		link: [{ rel: 'stylesheet', href: '/app.css', onload: 'attack()' }],
		script: [{ attributes: { type: 'module', src: '/app.js', async: true, nonce: 'safe', ONERROR: 'attack()' } }],
	});
	expect(html).toContain('<title>Safe &lt;title&gt;</title>');
	expect(html).toContain('content="Safe &quot;text&quot;"');
	expect(html).toContain('src="/app.js" async nonce="safe"');
	expect(html).not.toContain('evil.test');
	expect(html).not.toContain('attack');
});

it('allows only element-specific attributes and safe URLs', () => {
	const html = renderDocumentHead({
		meta: [{ name: 'description', content: 'A page', 'http-equiv': 'refresh', href: 'javascript:alert(1)' }],
		link: [{ rel: 'canonical', href: 'javascript:alert(1)', src: '/wrong.js' }, { rel: 'stylesheet', href: 'https://example.test/app.css' }],
		script: [{ attributes: { src: 'https://evil.test/run.js', type: 'module', onload: 'attack()' } }, { attributes: { src: '/app.js', defer: true } }],
	});
	expect(html).toContain('<meta name="description" content="A page">');
	expect(html).toContain('<link rel="stylesheet" href="https://example.test/app.css">');
	expect(html).toContain('<script src="/app.js" defer></script>');
	expect(html).not.toContain('javascript:');
	expect(html).not.toContain('evil.test');
	expect(html).not.toContain('onload');
	expect(html).not.toContain('http-equiv');
});
