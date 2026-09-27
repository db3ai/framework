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

## Operational alerts

`OperationalAlerts` provides a durable operator outbox independent of queue
workers. Register `OperationalAlertRecord` in app migrations, construct the
service with explicit destinations plus existing `Mail` and `Log` instances,
then call `record({ key, summary, context })` from typed application/queue
outcomes. Write raw exceptions separately using `log.error({ err, incidentKey })`.
Do not use log messages as an application event bus.

Call `deliverDue()` from a separately supervised process. It claims a bounded
batch, acknowledges email/webhook channels independently, and retries failed
sends with capped backoff. An expired five-minute claim is recoverable after a
crash. Delivery is at least once: receivers must deduplicate alert IDs. Email
acceptance is not inbox delivery; Resend's idempotency window is provider-limited.
Custom Mail transports must bound their requests below the claim duration.

Webhooks require HTTPS, reject redirects, time out after ten seconds and sign
`timestamp.body` with HMAC-SHA256. The timestamp and hex signature are supplied
as `x-alert-timestamp` and `x-alert-signature`; `idempotency-key` is the persisted
alert ID. Verify signatures and timestamp freshness before accepting an alert.
Only safe summaries and allowlisted context belong in externally delivered
content. Destinations are fixed once selected; secrets remain in configuration.

Email renders the persisted incident as readable plain text and escaped HTML,
with labelled context, the detection time in UTC and log correlation identifiers.
Webhooks retain the JSON payload and signing contract. The email is a snapshot
at detection time; it does not claim the incident is still active at delivery.
The renderer does not sanitize private diagnostics: callers must continue to
allowlist everything they place in context.

Applications may also supply `emailDiagnostics` when operators should receive
exception details. This optional string is limited to 128,000 characters,
persisted with the incident, and rendered as escaped multiline email content.
It is excluded from webhook bodies, including signed payloads. The application
must redact the text before recording it and authorize its disclosure to the
configured email recipient. Omitting it preserves existing alert behaviour.

The application owns incident selection, retention, reconciliation, alert
thresholds and independent dead-man monitoring. SQL storage cannot report its
own complete outage. This service does not promise provider-wide grouping or
exactly-once external delivery.

The copyable [`reportOperationalFailure`](./examples/reportOperationalFailure.ts)
example shows the logging/outbox boundary without sending raw errors externally.
