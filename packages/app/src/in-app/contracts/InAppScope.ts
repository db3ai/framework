/** Explicit account or application-owned scope; tenant scopes require an authorization policy. */
export type InAppScope = { type: 'account'; id?: never } | { type: string; id: string };

/** Scope policy invoked for recipients and authenticated readers, including state mutations. */
export interface InAppOptions {
	/** Best-effort invalidation after committed writes. Failures never undo durable acceptance. */
	onChanged?: (userId: string) => void | Promise<void>;
	/** Reports failed invalidations; inbox state remains authoritative. */
	onDeliveryError?: (error: unknown) => void;
	/** Non-account scopes fail closed when this policy is absent. Check current membership and write permissions. */
	authorizeScope?: (userId: string, scope: InAppScope, operation: 'receive' | 'read' | 'update') => boolean | Promise<boolean>;
}
