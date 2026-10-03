import type { DocArticle } from '../docs';
import { frameworkAuthority } from '../generated/framework-authority';

/**
 * Resolves exact emitted types from the package's supported public subpath.
 *
 * @param importPath - Public import to look up in the generated package inventory.
 * @returns TypeScript declarations; missing evidence makes the docs build fail.
 */
function declaration(importPath: string): string {
	const entry = frameworkAuthority.publicExports.find(item => item.importPath === importPath);
	const sources: Readonly<Record<string, string>> = frameworkAuthority.declarationSources;
	if (!entry || !sources[entry.declarationPath]) throw new Error(`Missing public declaration: ${importPath}`);
	return sources[entry.declarationPath]!;
}

export const activeRecordApiArticle: DocArticle = {
	id: 'active-record-api', area: 'api', group: '@db3.ai/app', label: 'ActiveRecord API',
	title: 'ActiveRecord API reference', summary: 'Look up record, query and field methods, options and return types. Start with the guide for the normal workflow.',
	packageName: '@db3.ai/app', sourcePath: 'packages/app/src/db/README.md',
	includeSourceDocument: false,
	declarationPaths: ['dist/db/ActiveProjection.d.ts'],
	sections: [
		{ id: 'using-this-reference', title: 'Use the guide first', paragraphs: [
			'This reference is generated from the package declarations. Use it to check a method signature or option in the four public entry points below.',
			'Import normal model APIs from @db3.ai/app/db. Source-relative imports in a declaration are internal type dependencies, not new supported import paths. The package is still pre-release; availability is explained in the walkthrough.',
		], links: [{ label: 'ActiveRecord guide', articleId: 'active-record' }, { label: 'Run a complete note workflow', articleId: 'guide-workspace-notes' }] },
		{ id: 'record-methods', title: 'Records, validation and persistence', paragraphs: [
			'Use `create()`/new for an unsaved model; `save()` persists. `find()`/`findByPk()` return null when absent; `findOrFail()` throws. Request filling, validation, errors, dirty state, JSON, soft deletion and form metadata are listed below.',
			'`withDb()` provides a scoped connection. `useDb()`, constructor db options, `setDb()` and explicit query connections are lower-level controls; do not thread an optional database parameter through ordinary feature functions.',
		], codeSampleId: 'record-declaration' },
		{ id: 'query-methods', title: 'Queries, filters and results', paragraphs: [
			'The builder accepts logical field names. It covers field selection, filters, vector similarity, ordering, bounded reads, counts and deletion. `toKnex()` exposes the underlying query for advanced work; the application then owns raw result handling and SQL-level choices.',
		], codeSampleId: 'query-declaration' },
		{ id: 'projections', title: 'Joined and computed read shapes', paragraphs: ['`ActiveProjection` converts SQL rows through reusable fields without pretending a joined result is a writable table record. Import it from `@db3.ai/app/db`. Your query owns aliases and scope; the projection owns conversion and output.'], codeSampleId: 'projection-declaration' },
		{ id: 'field-contract', title: 'Field conversion and extension points', paragraphs: [
			'FieldType describes input, backend, database and display values. Use existing fields first. A custom field should override only the parts of that lifecycle which differ, and supply validation and schema metadata for its behaviour.',
		], codeSampleId: 'field-declaration' },
	],
	codeSamples: [
		{ id: 'projection-declaration', title: '@db3.ai/app/db/ActiveProjection', language: 'typescript', code: declaration('@db3.ai/app/db/ActiveProjection') },
		{ id: 'record-declaration', title: '@db3.ai/app/db/ActiveRecord', language: 'typescript', code: declaration('@db3.ai/app/db/ActiveRecord') },
		{ id: 'query-declaration', title: '@db3.ai/app/db/ActiveQueryBuilder', language: 'typescript', code: declaration('@db3.ai/app/db/ActiveQueryBuilder') },
		{ id: 'field-declaration', title: '@db3.ai/app/db/FieldType', language: 'typescript', code: declaration('@db3.ai/app/db/FieldType') },
	],
	relatedIds: ['active-record', 'guide-workspace-notes'], keywords: ['ActiveRecord advanced API methods overloads FieldType ActiveQueryBuilder'],
};
