import type { InAppMessage, InAppScope } from '../../in-app';
import type { MailMessage } from '../../mail';

/** Framework delivery channels currently supported by notification classes. */
export type NotificationChannel = 'inApp' | 'mail';

/** Minimum persisted identity accepted by the notification service. */
export interface NotificationUser {
	/** Stable application identity used for delivery ownership and deduplication. */
	id: string | null;
}

/**
 * Application-owned notification content and routing policy.
 *
 * Channel renderers return data only. They must not persist messages, contact
 * providers or depend on an active HTTP request.
 */
export interface Notification<TUser extends NotificationUser = NotificationUser> {
	/** Stable application-owned type used for inbox filtering and deduplication. */
	readonly type: string;

	/**
	 * Selects delivery channels for one resolved user.
	 *
	 * @param user - Persisted recipient, available for future preference checks.
	 * @returns Distinct supported channels to deliver.
	 */
	via(user: TUser): readonly NotificationChannel[];

	/**
	 * Resolves recipient scope for authorization and inbox queries.
	 *
	 * @param user - Persisted recipient receiving this occurrence.
	 * @returns Account scope by default, or an application-owned scope.
	 */
	scope?(user: TUser): InAppScope;

	/**
	 * Returns a stable business identity used to deduplicate retries.
	 *
	 * @param user - Persisted recipient receiving this occurrence.
	 * @returns Application-owned occurrence key, or undefined for no deduplication.
	 */
	key?(user: TUser): string | undefined;

	/**
	 * Renders durable in-app content when `via()` selects `inApp`.
	 *
	 * @param user - Persisted recipient receiving this occurrence.
	 * @returns Validated content stored in the recipient's inbox.
	 */
	toInApp?(user: TUser): InAppMessage;

	/**
	 * Renders email content when `via()` selects `mail`.
	 *
	 * @param user - Persisted recipient receiving this occurrence.
	 * @returns Provider-neutral mail content ready for the configured transport.
	 */
	toMail?(user: TUser): MailMessage;
}

/** User model or stable ID accepted by notification delivery. */
export type NotificationRecipient<TUser extends NotificationUser> = TUser | string;
