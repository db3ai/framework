import { renderToString } from '@vue/server-renderer';
import type { SsrRenderer } from '@db3.ai/app/ssr';
import { createDocsApp } from './createDocsApp';
import { findArticle, type DocArticle } from './docs';
import { documentationPageMetadata, type DocumentationPageKind } from './pageMetadata';
import { parseDocumentationRoute } from './siteRoutes';

/** Hydration state shared with the documentation client entry. */
interface DocsHydrationState {
	/** Server-rendered public location used for deterministic hydration. */
	location: string;
}

/**
 * Renders one canonical db3.ai framework documentation request.
 *
 * @param context - Framework-owned request render context.
 * @returns Rendered Vue markup, SEO metadata, hydration state, and status.
 */
export const render: SsrRenderer<DocsHydrationState> = async context => {
	// createDocsServer overwrites this internal header with its validated origin.
	const configuredOrigin = context.request.headers['x-db3-docs-origin'];
	const origin = typeof configuredOrigin === 'string' ? configuredOrigin : 'https://framework.db3.ai';
	const url = requestUrl(context.request.url, origin);
	const location = `${url.pathname}${url.search}`;
	const route = parseDocumentationRoute(location);
	const article = route.kind === 'article' ? findArticle(route.articleId) : null;
	const notFound = route.kind === 'not-found' || (route.kind === 'article' && !article);
	const application = createDocsApp(location);

	applyDocumentHead(context, article, notFound ? 'not-found' : route.kind, origin);

	return {
		appHtml: await renderToString(application, context),
		status: notFound ? 404 : 200,
		state: { location },
		headers: {
			'cache-control': notFound
				? 'public, max-age=60'
				: 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
			...(notFound ? { 'x-robots-tag': 'noindex, nofollow' } : {}),
		},
	};
};

/**
 * Populates canonical metadata for a landing, article, or not-found render.
 *
 * @param context - Request-owned SSR context collecting document metadata.
 * @param article - Resolved canonical article, when one exists.
 * @param kind - Resolved public page kind controlling search metadata.
 * @param origin - Trusted canonical origin selected by the owning HTTP server.
 */
function applyDocumentHead(
	context: Parameters<SsrRenderer<DocsHydrationState>>[0],
	article: DocArticle | null,
	kind: DocumentationPageKind,
	origin: string,
): void {
	const metadata = documentationPageMetadata(kind, article);
	const canonical = metadata.canonicalPath ? canonicalUrl(metadata.canonicalPath, origin) : null;

	context.head.title = metadata.title;

	if (metadata.description) {
		context.head.meta.push(
			{ name: 'description', content: metadata.description },
			{ property: 'og:title', content: metadata.title },
			{ property: 'og:description', content: metadata.description },
			{ property: 'og:type', content: metadata.openGraphType },
			...(canonical ? [{ property: 'og:url', content: canonical }] : []),
		);
	}

	if (metadata.robots) context.head.meta.push({ name: 'robots', content: metadata.robots });
	if (canonical) context.head.link.push({ rel: 'canonical', href: canonical });
}

/**
 * Resolves an absolute public canonical URL for one application path.
 *
 * @param path - Root-relative canonical route.
 * @param origin - Trusted website origin from the request render context.
 * @returns Absolute db3.ai URL.
 */
function canonicalUrl(path: string, origin: string): string {
	return new URL(path, origin).toString();
}

/**
 * Parses a request URL against the public documentation origin.
 *
 * @param value - Relative URL supplied by the Fastify transport.
 * @param origin - Trusted website origin from the request render context.
 * @returns Complete URL used for route and metadata resolution.
 */
function requestUrl(value: string, origin: string): URL {
	return new URL(value, origin);
}
