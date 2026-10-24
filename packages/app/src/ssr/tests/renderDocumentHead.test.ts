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
