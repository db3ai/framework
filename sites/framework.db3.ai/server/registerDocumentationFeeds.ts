import type { FastifyInstance, FastifyReply } from 'fastify';
import { docArticles } from '../src/docs.js';
import { articleReferencePath } from '../src/articleContent.js';
import { documentationSourceContent } from '../src/generated/documentation-sources.js';
import { documentationArticleMarkdown, documentationOrigin, documentationRobotsText, documentationSitemapXml, llmsFullText, llmsText } from '../src/documentationMarkdown.js';

/**
 * Public configuration for the documentation discovery feeds.
 */
export interface DocumentationFeedsOptions {
	/** Canonical website origin. Defaults to https://framework.db3.ai. */
	origin?: string;
}

const documentCacheControl = 'public, max-age=300, stale-while-revalidate=86400';

/**
 * Registers canonical Markdown, AI discovery, sitemap, and crawler routes.
 *
 * Article routes are registered as explicit static paths from the trusted
 * documentation registry. The browser never supplies code, source paths, or
 * commands for the server to resolve or execute.
 *
 * @param server - Fastify website instance that owns the documentation routes.
 * @param options - Optional canonical-origin override for previews and tests.
 */
export function registerDocumentationFeeds(
	server: FastifyInstance,
	options: DocumentationFeedsOptions = {},
): void {
	const origin = documentationOrigin(options.origin);
	const llmsDocument = llmsText({ origin });
	const llmsFullDocument = llmsFullText({ origin });
	const sitemapDocument = documentationSitemapXml({ origin });
	const robotsDocument = documentationRobotsText({ origin });

	server.get('/llms.txt', async (_request, reply) => {
		return sendDocument(reply, 'text/plain; charset=utf-8', llmsDocument);
	});

	server.get('/llms-full.txt', async (_request, reply) => {
		return sendDocument(reply, 'text/plain; charset=utf-8', llmsFullDocument);
	});

	server.get('/sitemap.xml', async (_request, reply) => {
		return sendDocument(reply, 'application/xml; charset=utf-8', sitemapDocument);
	});

	server.get('/robots.txt', async (_request, reply) => {
		return sendDocument(reply, 'text/plain; charset=utf-8', robotsDocument);
	});

	for (const article of docArticles) {
		const encodedArticleId = encodeURIComponent(article.id);
		const articleDocument = documentationArticleMarkdown(article, { origin });
		const referencePath = articleReferencePath(article);
		if (referencePath) {
			const source = (documentationSourceContent as Readonly<Record<string, string>>)[article.sourcePath];
			if (!source) throw new Error(`Missing public reference for ${article.id}. Regenerate documentation.`);
			server.get(referencePath, async (_request, reply) => {
				return sendDocument(reply, 'text/markdown; charset=utf-8', source);
			});
		}


		server.get(`/docs/${encodedArticleId}.md`, async (_request, reply) => {
			reply.header('link', `<${new URL(`/docs/${encodedArticleId}`, origin).toString()}>; rel="canonical"`);

			return sendDocument(reply, 'text/markdown; charset=utf-8', articleDocument);
		});
	}
}

/**
 * Applies stable discovery-document headers and sends a generated body.
 *
 * @param reply - Active Fastify response.
 * @param contentType - Exact text or XML content type for the feed.
 * @param body - Complete generated document body.
 * @returns Fastify reply after the document has been sent.
 */
function sendDocument(reply: FastifyReply, contentType: string, body: string): FastifyReply {
	return reply
		.type(contentType)
		.header('cache-control', documentCacheControl)
		.header('content-language', 'en')
		.send(body);
}
