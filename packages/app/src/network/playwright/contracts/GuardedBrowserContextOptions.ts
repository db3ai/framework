import type { Request } from 'playwright';
import type { BlockedUrlError } from '../../BlockedUrlError';
import type { PublicUrlOptions } from '../../contracts';

/**
 * Details passed to the observer when the guard refuses a browser request.
 */
export interface BlockedBrowserRequest {
	/** URL the page tried to load. */
	url: string;

	/** Guard rejection with a caller-safe message. */
	error: BlockedUrlError;

	/**
	 * Playwright request that was aborted.
	 *
	 * Use `request.isNavigationRequest()` and `request.frame()` to tell whether
	 * the page's own navigation was refused rather than an embedded resource.
	 */
	request: Request;
}

/**
 * Network policy for a browser context whose traffic is routed through the guard.
 */
export interface GuardedBrowserContextOptions extends PublicUrlOptions {
	/**
	 * Playwright resource types aborted without a network request, for example
	 * `['image', 'font', 'media']` when only the rendered DOM is needed.
	 */
	blockedResourceTypes?: readonly string[];

	/** Socket inactivity timeout in milliseconds. Defaults to 30 seconds. */
	requestTimeoutMs?: number;

	/**
	 * Observer called for each request refused by the destination policy.
	 *
	 * The request is aborted whether or not an observer is supplied.
	 */
	onBlocked?: (blocked: BlockedBrowserRequest) => void;
}
