import type { FlowValues } from '@db3.ai/app/flows';

import type { DemoWebsitePage } from '../models/index.js';

/** Link ownership category used by article selection and final validation. */
export type ArticleLinkKind = 'internal' | 'external';

/**
 * Converts an indexed demo page into compact JSON-safe editorial evidence.
 *
 * @param page - Indexed website page returned by the model query.
 * @param kind - Whether the page belongs to the article website.
 * @returns Link candidate safe to capture at a flow boundary.
 */
export function linkCandidate(page: DemoWebsitePage, kind: ArticleLinkKind): FlowValues {
	return {
		id: String(page.id),
		kind,
		url: String(page.url),
		title: String(page.title),
		summary: String(page.summary),
		anchorText: String(page.anchorText),
		relevanceScore: Number(page.relevanceScore),
		source: kind === 'internal' ? 'website_content' : 'backlink_exchange',
	};
}
