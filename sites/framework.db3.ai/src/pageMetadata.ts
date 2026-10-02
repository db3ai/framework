import type { DocArticle } from './docs';
import { documentationPath } from './siteRoutes';

/** Public page kinds with distinct search and social metadata. */
export type DocumentationPageKind = 'landing' | 'framework' | 'article' | 'not-found';

/**
 * Framework documentation metadata shared by SSR and client navigation.
 */
export interface DocumentationPageMetadata {
	/** Browser and search-result title. */
	title: string;
	/** Search and social summary, omitted for unknown routes. */
	description?: string;
	/** Canonical root-relative path, omitted for unknown routes. */
	canonicalPath?: string;
	/** Search crawler policy for routes that must not be indexed. */
	robots?: string;
	/** Open Graph content classification. */
	openGraphType?: 'website' | 'article';
}

/**
 * Resolves deterministic metadata for a documentation page.
 *
 * @param kind - Resolved public page kind.
 * @param article - Canonical article when rendering article metadata.
 * @returns Metadata safe to apply on the server and after client navigation.
 */
export function documentationPageMetadata(
	kind: DocumentationPageKind,
	article: DocArticle | null = null,
): DocumentationPageMetadata {
	if (kind === 'not-found') {
		return {
			title: 'Page not found | db3.ai Framework',
			robots: 'noindex, nofollow',
		};
	}

	if (kind === 'landing') {
		return {
			title: 'db3.ai Framework Documentation',
			description: 'Typed application services, executable examples, and API guidance for building with the db3.ai framework.',
			canonicalPath: '/',
			openGraphType: 'website',
		};
	}

	if (kind === 'framework') {
		return {
			title: 'db3.ai Framework Documentation',
			description: 'Typed application services, executable examples, and API guidance for building with the db3.ai framework.',
			canonicalPath: '/framework',
			openGraphType: 'website',
		};
	}

	if (!article) return documentationPageMetadata('not-found');

	return {
		title: `${article.title} | db3.ai Framework`,
		description: article.summary,
		canonicalPath: documentationPath(article.id),
		openGraphType: 'article',
	};
}
