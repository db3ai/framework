import { describe, expect, it } from 'vitest';

import { createSsrRenderContext } from '..';
import { applyViteSsrManifest } from '../vite';

describe('applyViteSsrManifest', () => {
	it('adds unique request-used styles, scripts, fonts, and images to document head', () => {
		const context = createSsrRenderContext({
			method: 'GET',
			url: '/blog/ctr',
			headers: {},
		});
		context.modules.add('/src/pages/BlogArticle.vue');
		context.modules.add('/src/components/SiteHeader.vue');
		context.head.link.push({ rel: 'stylesheet', href: '/site-assets/shared.css' });

		applyViteSsrManifest(context, {
			'/src/pages/BlogArticle.vue': [
				'site-assets/article.css',
				'site-assets/article.js',
				'site-assets/heading.woff2',
				'site-assets/hero.webp',
			],
			'/src/components/SiteHeader.vue': [
				'site-assets/shared.css',
				'site-assets/article.js',
			],
		});

		expect(context.head.link).toEqual([
			{ rel: 'stylesheet', href: '/site-assets/shared.css' },
			{ rel: 'stylesheet', href: '/site-assets/article.css' },
			{ rel: 'modulepreload', crossorigin: true, href: '/site-assets/article.js' },
			{ rel: 'preload', href: '/site-assets/heading.woff2', as: 'font', type: 'font/woff2', crossorigin: true },
			{ rel: 'preload', href: '/site-assets/hero.webp', as: 'image' },
		]);
	});

	it('omits JavaScript preloads for deliberately non-hydrated pages', () => {
		const context = createSsrRenderContext({
			method: 'GET',
			url: '/blog',
			headers: {},
		});
		context.modules.add('/src/pages/BlogIndex.vue');

		applyViteSsrManifest(context, {
			'/src/pages/BlogIndex.vue': [
				'site-assets/blog.css',
				'site-assets/blog.js',
			],
		}, { preloadJavaScript: false });

		expect(context.head.link).toEqual([
			{ rel: 'stylesheet', href: '/site-assets/blog.css' },
		]);
	});
});
