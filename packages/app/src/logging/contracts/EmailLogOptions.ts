import type { MailAddress } from '../../mail';

/** Sends each error or fatal record to the configured operator through the application's Mail service. */
export interface EmailLogOptions {
	/** Explicit operator destination; disabled unless configured. */
	to: MailAddress | MailAddress[];
	/** Optional subject prefix identifying the application. Defaults to Application error. */
	subjectPrefix?: string;
	/** Maximum accepted messages awaiting delivery, including the active send. Defaults to 100. */
	maxPending?: number;
	/** Maximum accepted messages in a one-minute window. Defaults to 60. Other log destinations retain suppressed records. */
	maxPerMinute?: number;
}
