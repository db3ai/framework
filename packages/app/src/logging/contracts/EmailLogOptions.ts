import type { MailAddress } from '../../mail';

/** Sends each error or fatal record to the configured operator through the application's Mail service. */
export interface EmailLogOptions {
	/** Explicit operator destination; disabled unless configured. */
	to: MailAddress | MailAddress[];
	/** Optional subject prefix identifying the application. Defaults to Application error. */
	subjectPrefix?: string;
}
