import type { DocArticle } from './docs';
import { findLearningCourse, learningPath } from './learning';
import { documentationPath } from './siteRoutes';

/** Public page kinds with distinct search and social metadata. */
export type DocumentationPageKind = 'landing' | 'learning' | 'article' | 'not-found';

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
 * @param courseId - Stable learning course identifier for course pages.
 * @returns Metadata safe to apply on the server and after client navigation.
 */
export function documentationPageMetadata(
	kind: DocumentationPageKind,
	article: DocArticle | null = null,
	courseId = '',
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
			canonicalPath: '/framework',
			openGraphType: 'website',
		};
	}

	if (kind === 'learning') {
		if (!courseId) return {
			title: 'Learn db3 Framework | Course outlines',
			description: 'Project-led db3 Framework course outlines for your first app, AI features, and AI-assisted development. Videos are planned; written guides are available now.',
			canonicalPath: learningPath(),
			openGraphType: 'website',
		};

		const course = findLearningCourse(courseId);
		if (!course) return documentationPageMetadata('not-found');

		return {
			title: `${course.title} | db3 Framework Learn`,
			description: `${course.summary} Lesson outline available; videos are planned.`,
			canonicalPath: learningPath(course.id),
			openGraphType: 'article',
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
