import { createHash } from 'node:crypto';
import type { UserIdentity, UserIdentityModel } from '../auth';
import type { InApp } from '../in-app';
import type { Mail, MailMessage } from '../mail';
import type * as notifications from './contracts';

/** Coordinates application-owned notification classes with framework channels. */
export class Notifications<TUser extends UserIdentity = UserIdentity> {
	/**
	 * Creates the notification coordinator used by app().notifications.
	 *
	 * @param inApp - Durable framework inbox service.
	 * @param mail - Provider-neutral framework mail service.
	 * @param identityModel - Application identity model used to resolve ID recipients.
	 */
	constructor(
		private readonly inApp: InApp,
		private readonly mail: Mail,
		private readonly identityModel: UserIdentityModel<TUser>,
	) {}

	/**
	 * Delivers one notification to one or more users through its `via()` channels.
	 *
	 * @param recipients - User model, ID, or an array mixing both forms.
	 * @param notification - Application-owned routing and channel renderers.
	 * @returns One delivery result per distinct resolved user.
	 */
	async send(
		recipients: notifications.NotificationRecipient<TUser> | readonly notifications.NotificationRecipient<TUser>[],
		notification: notifications.Notification<TUser>,
	): Promise<notifications.NotificationDelivery[]> {
		if (!notification.type?.trim()) throw new Error('Notification type is required.');
		const users = await this.#resolveUsers(recipients);
		const deliveries: notifications.NotificationDelivery[] = [];

		for (const user of users) deliveries.push(await this.#deliver(user, notification));

		return deliveries;
	}

	/**
	 * Delivers selected channels for one canonical user.
	 *
	 * @param user - Resolved application identity.
	 * @param notification - Application-owned routing and content definition.
	 * @returns Accepted in-app and mail outcomes for the recipient.
	 */
	async #deliver(user: TUser, notification: notifications.Notification<TUser>): Promise<notifications.NotificationDelivery> {
		const userId = String(user.id);
		const channels = [...new Set(notification.via(user))];
		if (!channels.length) return { userId, inApp: null, mail: null };
		if (channels.some(channel => !['inApp', 'mail'].includes(channel))) throw new Error(`Notification "${notification.type}" selected an unsupported channel.`);
		const scope = notification.scope?.(user) ?? { type: 'account' as const };
		const key = notification.key?.(user);
		let inApp = null;
		let mail = null;

		if (channels.includes('inApp')) {
			if (!notification.toInApp) throw new Error(`Notification "${notification.type}" selected inApp without a toInApp() renderer.`);
			[inApp] = await this.inApp.send(userId, notification.toInApp(user), { scope, type: notification.type, key });
		}
		if (channels.includes('mail')) {
			if (!notification.toMail) throw new Error(`Notification "${notification.type}" selected mail without a toMail() renderer.`);
			mail = await this.mail.send(withDeliveryKey(notification.toMail(user), notification.type, key, userId));
		}

		return { userId, inApp, mail };
	}

	/**
	 * Resolves model and ID inputs, rejecting missing identities before delivery.
	 *
	 * @param recipients - User model, ID, or bounded array of either form.
	 * @returns Distinct canonical users in first-seen order.
	 */
	async #resolveUsers(recipients: notifications.NotificationRecipient<TUser> | readonly notifications.NotificationRecipient<TUser>[]): Promise<TUser[]> {
		const input = Array.isArray(recipients) ? recipients : [recipients];
		if (input.length > 100) throw new Error('Notifications accepts at most 100 recipients per send.');
		const users = new Map<string, TUser>();

		for (const recipient of input) {
			const user = typeof recipient === 'string' ? await this.identityModel.find(recipient) : recipient;
			if (!user?.id) throw new Error('Notification recipient is unavailable.');
			users.set(String(user.id), user);
		}

		return [...users.values()];
	}
}

/**
 * Adds a stable provider retry identity when the renderer did not provide one.
 *
 * @param message - Provider-neutral mail content rendered by the notification.
 * @param type - Stable notification type.
 * @param key - Optional application-owned occurrence key.
 * @param userId - Canonical recipient identity.
 * @returns Original or copied message with an idempotency key when possible.
 */
function withDeliveryKey(message: MailMessage, type: string, key: string | undefined, userId: string): MailMessage {
	if (message.idempotencyKey || !key) return message;
	const hash = createHash('sha256').update(JSON.stringify([type, key, userId])).digest('hex');
	return { ...message, idempotencyKey: `notification/${hash}` };
}
