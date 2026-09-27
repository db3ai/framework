import type { Notification } from '@db3.ai/app/notifications';

/** One durable inbox reminder per saved discussion; repeated hourly runs and job retries deduplicate it. */
export class SavedOpportunityNotification implements Notification {
	readonly type = 'social.saved-opportunity';

	/** Receives only the durable discussion identity and plain-text title. */
	constructor(private readonly id: string, private readonly title: string) {}

	/** Keeps this example inside the host inbox without sending external messages. */
	via() { return ['inApp'] as const; }

	/** Uses the discussion's identity so subsequent hourly reviews do not create duplicate reminders. */
	key(): string { return this.id; }

	/** Renders a private reminder whose destination enforces the host session. */
	toInApp() {
		return { title: 'A discussion to review', body: this.title, presentation: 'inbox' as const, action: { label: 'Open Social', href: '/#apps/social' } };
	}
}
