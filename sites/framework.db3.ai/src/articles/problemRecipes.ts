import type { DocArticle } from '../docs';

export const problemRecipesArticle: DocArticle = {
	id: 'solve-a-problem', area: 'cookbook', group: 'Problems and recipes', label: 'Solve a problem',
	title: 'Solve a problem', summary: 'Start with the feature you need. Follow one workflow across the services it uses.',
	packageName: '@db3.ai/app', sourcePath: 'packages/app/README.md',
	includeSourceDocument: false,
	sections: [
		{ id: 'realtime', title: 'Push server activity to connected users', paragraphs: ['Follow the WebSocket guide for one shared connection, then choose a tutorial for a shared board, background operation or deployment timeline. Each tutorial distinguishes saved state, live delivery and recovery.'], links: [{ label: 'WebSocket guide and tutorials', articleId: 'websocket', sectionId: 'tutorials' }, { label: 'Deployment progress', articleId: 'realtime-deployments' }] },
		{ id: 'signed-in-notes', title: 'Add a private feature behind login', paragraphs: ['Start with the generated Notes app. Trace its cookie session, validate a request, query by the trusted owner and test foreign-account access. The API walkthrough includes the generated route source and tests.'], links: [{ label: 'Login and sessions', articleId: 'guide-auth' }, { label: 'Owned note API', articleId: 'guide-api' }] },
		{ id: 'private-files', title: 'Accept and serve a private file', paragraphs: ['Available as an installed-package lab. Use real Auth, Media and Storage through a small HTTP factory. Reject foreign reads, invalid uploads and oversized bodies, then delete both metadata and bytes. The matching test keeps all three services real.'], links: [{ label: 'Private-file walkthrough', articleId: 'guide-files' }, { label: 'Cross-service testing', articleId: 'guide-testing' }] },
		{ id: 'stream-export', title: 'Build a large export safely', paragraphs: ['Stream a CSV into a private staging path and replace the final export only after success. Trigger a source failure, preserve the previous file and recover. This bounded-memory lab is separate from an HTTP download/disconnect policy.'], links: [{ label: 'Streamed exports', articleId: 'cookbook-streams' }] },
		{ id: 'repair-flow', title: 'Inspect and replay a failed workflow', paragraphs: ['Save a two-block definition, inspect its durable result and repair invalid input. Compare replay against the saved definition snapshot with replay against the latest definition; a graph snapshot is not a snapshot of deployed block code.'], links: [{ label: 'Durable flows', articleId: 'flows' }] },
		{ id: 'queued-report', title: 'Build a report and recover a failed job', paragraphs: ['Available as a pre-release package lab. Queue persists a report across App lifetimes, Storage supplies its input and output, and a SQL-backed worker retries, records failure and replays after repair. Repeated work replaces the same output. This is not exactly-once email delivery or a provider billing guarantee.'], links: [{ label: 'Run the queued-report walkthrough', articleId: 'queue-overview', sectionId: 'setup' }] },
		{ id: 'workspace-notes', title: 'Keep workspace data separate', paragraphs: [
			'Available as a pre-release package lab. Create and edit notes without accepting ownership from request data. Covers App, ActiveRecord, field validation, scoped reads and transactions. It does not provide the authentication or membership layer.',
		], links: [{ label: 'Run the workspace notes walkthrough', articleId: 'guide-workspace-notes' }] },
		{ id: 'ai-credits', title: 'Charge credits for AI usage', paragraphs: [
			'Planned guide. Charge application credits for AI requests, reserve a balance safely across concurrent requests and avoid charging twice after a retry.',
			'The guide will cover failed requests, uncertain costs and refunds. Provider cost and the customer’s credit charge are separate values.',
			'The starter has optional server-side text generation, but reusable accounting and allowance APIs are not available yet. You can use ActiveRecord and transactions today; this billing walkthrough will follow when those contracts are ready.',
		], links: [{ label: 'Transaction foundations', articleId: 'active-record', sectionId: 'transactions' }] },
		{ id: 'file-processing', title: 'Upload a file and process it in the background', paragraphs: [
			'Planned guide. Upload a file, process it in a worker and show progress. Start with the private-file and background-worker guides below. File storage and queue dispatch are separate operations, so your application must handle partial failures.',
		], links: [{ label: 'Private upload foundation', articleId: 'guide-files' }, { label: 'Background worker foundation', articleId: 'guide-background' }] },
		{ id: 'delivery', title: 'Send a scheduled report once', paragraphs: [
			'Planned guide. Schedule a report, build it in a worker and email it. Keep delivery history on an application model and use a stable delivery identifier to handle retries. Queue retries alone do not prevent duplicate email.',
		] },
	],
	relatedIds: ['guide-workspace-notes', 'active-record', 'queue-overview'], keywords: ['solve problem recipe billing credits AI usage ledger file upload scheduled report'],
};
