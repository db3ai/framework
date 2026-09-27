import type { InAppMessage } from './InAppMessage';
import type { InAppScope } from './InAppScope';

/** A safe recipient-facing view; internal deduplication hashes are never exposed. */
export interface InAppItem {
	id: string;
	type: string;
	message: InAppMessage;
	createdAt: string;
	readAt: string | null;
	/** Dismissal hides a banner without removing its inbox item or implying it was read. */
	dismissedAt: string | null;
	archivedAt: string | null;
}

/** Trusted server dispatch metadata. Sending is not a public browser-authorized operation. */
export interface InAppSendOptions {
	scope: InAppScope;
	/** Stable notification type, for example content-plan.ready. */
	type: string;
	/** Retry identity, unique within type, scope and recipient. Omit to create a new occurrence. */
	key?: string;
}

/** One result per distinct recipient, in first-input order. Empty input returns an empty array. */
export interface InAppAcceptance {
	userId: string;
	id: string;
	status: 'created' | 'existing';
}

/** Query for the authenticated user's inbox in one explicit scope. */
export interface InAppInboxQuery {
	scope: InAppScope;
	/** Defaults to 25; maximum 100. */
	limit?: number;
	/** ID from nextBefore. Pagination is an inbox position, not a realtime/replay cursor. */
	before?: string;
	/** Defaults to inbox; banners excludes dismissed items. All views exclude archived items. */
	view?: 'inbox' | 'banners';
}

/** Paginated items and the unread count for the whole unarchived scoped inbox. */
export interface InAppInboxPage {
	items: InAppItem[];
	unreadCount: number;
	nextBefore: string | null;
}

/** Explicit independent recipient state transitions. */
export type InAppTransition = 'read' | 'unread' | 'dismiss' | 'archive';
