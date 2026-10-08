# Notifications

`@db3.ai/app/notifications` coordinates application-owned notification classes
with the framework's durable in-app and mail services. A notification owns its
channel policy and renderers; it returns content and never performs delivery.

```ts
import type { Notification } from '@db3.ai/app/notifications';
import type { User } from '../models/User.js';

class ReportReadyNotification implements Notification<User> {
	readonly type = 'report.ready';

	constructor(private readonly reportId: string) {}

	via(user: User) {
		return user.email ? ['inApp', 'mail'] as const : ['inApp'] as const;
	}

	key(_user: User) {
		return this.reportId;
	}

	toInApp(_user: User) {
		return { title: 'Your report is ready', body: 'Open the report to review it.' };
	}

	toMail(user: User) {
		return { to: user.email!, subject: 'Your report is ready', text: 'Open the app to review it.' };
	}
}

await app().notifications.send(user, new ReportReadyNotification(reportId));
await app().notifications.send(users, new ReportReadyNotification(reportId));
```

An app may add a small convenience method to its user model:

```ts
public async notify(notification: Notification<this>) {
	return app().notifications.send(this, notification);
}

await user.notify(new ReportReadyNotification(reportId));
```

The service resolves IDs through the configured auth identity model, removes
duplicate recipients, then stores in-app content before submitting email for
each user. A stable notification `key()` deduplicates inbox retries and supplies
a stable mail-provider idempotency key.

The coordinator does not yet persist a generic per-channel delivery log, resolve
notification preferences, or discover notification classes automatically.

## Error reporting

Use `app().log.error({ err: error }, 'Operation failed')` for operational errors.
Logging owns configurable email and other transports; application notifications
remain recipient-facing messages. See [logging](../logging/README.md).
