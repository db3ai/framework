import { describe, expect, it } from 'vitest';

import {
	createSsrRenderContext,
	renderSsrDocument,
	serializeSsrState,
	SSR_APP_MARKER,
	SSR_HEAD_MARKER,
	SSR_STATE_MARKER,
} from '..';

describe('renderSsrDocument', () => {
	it('preserves replacement tokens and marker-like content without reinterpreting rendered values', () => {
		const context = createSsrRenderContext({ method: 'GET', url: '/', headers: {} });
		const literal = "$& $` $' $$";
		context.head.title = literal;
		context.state.value = literal;
		const body = `<main>${literal}${SSR_STATE_MARKER}</main>`;
		const document = renderSsrDocument(`<head>${SSR_HEAD_MARKER}</head>${SSR_APP_MARKER}<script>${SSR_STATE_MARKER}</script>`, context, { appHtml: body });
		expect(document).toContain(`<title>$&amp; $\` $&#39; $$</title>`);
		expect(document).toContain(body);
		expect(document).toContain(`<script>${serializeSsrState(context.state)}</script>`);
	});
	it('assembles rendered markup, one head pipeline and hydration state', () => {
		const context = createSsrRenderContext({
			method: 'GET',
			url: '/blog/click-through-rate',
			headers: {},
		});

		context.head.title = 'CTR & search';
		context.head.meta.push({ name: 'description', content: 'Clicks < impressions' });
		context.head.link.push({ rel: 'canonical', href: 'https://example.test/blog/ctr?a=1&b=2' });
		context.head.script.push({
			attributes: { type: 'application/ld+json' },
			content: '{"name":"CTR </script> guide"}',
		});
		context.state.article = {
			title: '</script><script>alert("unsafe")</script>',
		};

		const template = [
			'<!doctype html><html><head>',
			SSR_HEAD_MARKER,
			'</head><body><div id="app">',
			SSR_APP_MARKER,
			'</div><script id="__PLATFORM_SSR_STATE__" type="application/json">',
			SSR_STATE_MARKER,
			'</script></body></html>',
		].join('');
		const document = renderSsrDocument(template, context, {
			appHtml: '<article><h1>Click-through rate</h1></article>',
		});

		expect(document).toContain('<title>CTR &amp; search</title>');
		expect(document).toContain('<meta name="description" content="Clicks &lt; impressions">');
		expect(document).toContain('href="https://example.test/blog/ctr?a=1&amp;b=2"');
		expect(document).toContain('{"name":"CTR <\\/script> guide"}');
		expect(document).toContain('<article><h1>Click-through rate</h1></article>');
		expect(document).toContain('"title":"\\u003c/script\\u003e\\u003cscript\\u003ealert');
		expect(document).not.toContain(SSR_HEAD_MARKER);
		expect(document).not.toContain(SSR_APP_MARKER);
		expect(document).not.toContain(SSR_STATE_MARKER);
	});

	it('supports deliberately non-hydrated templates without head or state markers', () => {
		const context = createSsrRenderContext({
			method: 'GET',
			url: '/legal/privacy',
			headers: {},
		});

		const document = renderSsrDocument(`<main>${SSR_APP_MARKER}</main>`, context, {
			appHtml: '<h1>Privacy</h1>',
		});

		expect(document).toBe('<main><h1>Privacy</h1></main>');
	});

	it('rejects a template that cannot expose the rendered application markup', () => {
		const context = createSsrRenderContext({
			method: 'GET',
			url: '/',
			headers: {},
		});

		expect(() => renderSsrDocument('<html></html>', context, {
			appHtml: '<h1>Home</h1>',
		})).toThrow(`SSR template must contain ${SSR_APP_MARKER}.`);
	});
});

describe('serializeSsrState', () => {
	it('escapes HTML delimiters and JavaScript line separators', () => {
		const state = serializeSsrState({
			value: '<>&\u2028\u2029',
		});

		expect(state).toBe('{"value":"\\u003c\\u003e\\u0026\\u2028\\u2029"}');
	});
});
