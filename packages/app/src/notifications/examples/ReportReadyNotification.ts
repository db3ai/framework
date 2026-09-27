import type { Notification } from '@db3.ai/app/notifications';
import type { UserIdentity } from '@db3.ai/app/auth';

/** Example code-owned notification with explicit in-app and email renderers. */
export class ReportReadyNotification implements Notification<UserIdentity> {
	readonly type = 'report.ready';

	/** Creates a report-ready notification for one report occurrence. */
	constructor(private readonly reportId: string) {}

	/** Selects durable in-app and email delivery for this recipient. */
	via(_user: UserIdentity) {
		return ['inApp', 'mail'] as const;
	}

	/** Returns the report occurrence identity used to deduplicate retries. */
	key(_user: UserIdentity) {
		return this.reportId;
	}

	/** Returns the durable inbox content. */
	toInApp(_user: UserIdentity) {
		return { title: 'Your report is ready', body: 'Open the report to review it.', presentation: 'banner' as const };
	}

	/** Returns provider-neutral email content. */
	toMail(user: UserIdentity) {
		if (!user.email) throw new Error('Report notification requires a recipient email.');
		return { to: user.email, subject: 'Your report is ready', text: 'Open the app to review it.' };
	}
}
