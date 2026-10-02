import type { DocArticle } from '../docs';
import { frameworkAuthority } from '../generated/framework-authority';

/** One emitted declaration group rendered under a stable section anchor. */
export type ApiReferenceSource = readonly [id: string, title: string, path: string];

/** Inputs for an advanced reference whose signatures are generated, not copied. */
export interface ApiReferenceOptions {
	id: string;
	label: string;
	packageName: string;
	sourcePath: string;
	guideId: string;
	references: readonly ApiReferenceSource[];
}

/**
 * Renders explicitly selected declarations from the publish-shaped package.
 *
 * @param options - Public import, guide and package-relative declaration inventory.
 * @returns Navigable API article; source generation validates every declaration.
 */
export function createApiReference(options: ApiReferenceOptions): DocArticle {
	const sources: Readonly<Record<string, string>> = frameworkAuthority.declarationSources;
	return {
		id: options.id, area: 'api', group: '@db3.ai/app', label: options.label, title: `${options.label} reference`,
		summary: `Current emitted signatures and options for ${options.packageName}.`,
		packageName: options.packageName, sourcePath: options.sourcePath, includeSourceDocument: false,
		declarationPaths: options.references.map(reference => reference[2]),
		sections: [{ id: 'start', title: 'Imports and examples', paragraphs: [`Import supported APIs from \`${options.packageName}\`. These signatures come from the staged package used by consumers. Relative filenames in declarations describe type dependencies; they are not extra supported deep imports.`, 'Use the guide for setup, runnable examples, error handling and tests.'], links: [{ label: 'Guide, examples and testing', articleId: options.guideId }] }, ...options.references.map(([id, title]) => ({ id, title, paragraphs: [], codeSampleId: id }))],
		codeSamples: options.references.map(([id, title, path]) => ({ id, title, language: 'typescript', code: sources[path] ?? '' })),
		relatedIds: [options.guideId],
	};
}
