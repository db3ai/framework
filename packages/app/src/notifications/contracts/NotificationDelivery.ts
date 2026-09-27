import type { InAppAcceptance } from '../../in-app';
import type { MailDelivery } from '../../mail';
/** Accepted channel outcomes for one resolved user. */
export interface NotificationDelivery {
	/** Stable recipient identity. */
	userId: string;
	/** Durable in-app acceptance, or null when the notification omitted the channel. */
	inApp: InAppAcceptance | null;
	/** Mail transport acceptance, or null when the renderer omitted the channel. */
	mail: MailDelivery | null;
}
