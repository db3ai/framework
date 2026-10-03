# Intercom notifications

`@db3.ai/notifications-intercom` is an additive provider package in the framework
repository. It uses runtime `fetch`, with no Intercom SDK or core runtime changes.
It does not replace Scout inbox messages, select channels, queue jobs or record
job state. The same server client can be called by an application job.

```ts
import { IntercomNotifications } from '@db3.ai/notifications-intercom';

const intercom = new IntercomNotifications({
	accessToken: process.env.INTERCOM_ACCESS_TOKEN!,
	adminId: process.env.INTERCOM_ADMIN_ID,
});
await intercom.send(userId, 'onboarding_notification', {
	report_url: 'https://growthscout.io/app/dashboard',
	website_name: 'Example',
});
```

`send` posts an Intercom event. Create and activate an event-triggered **in-app**
message in Intercom Outbound to control copy, design, metadata, audience and
frequency. Event acceptance does not prove message delivery. Event-triggered
messages require Intercom's Proactive Support Plus add-on; newly tracked metadata
may take 24 hours to appear in the composer. REST events do not support current
page URL targeting. See [Intercom event messages](https://www.intercom.com/help/en/articles/5180516-send-repeatable-messages-based-on-events-you-track-in-intercom).

For an immediate direct-message experiment, `sendMessage(userId, { title, body,
action?: { label, href } })` posts `message_type: 'inapp'` and returns its acceptance
ID. It requires a teammate `adminId`; it does not select an admin-authored Outbound
template. Text is escaped and action links must be absolute HTTP(S) URLs.

Both operations resolve recipients through their canonical application external
ID, never email. Missing contacts are created as users. HTTP requests reject
redirects and share one ten-second deadline. Errors propagate once; the caller
owns retry policy and any future job state. A lost acknowledgement can duplicate
a message on a retry. No persistence tables are introduced.

Local verification: `npm test --workspace @db3.ai/notifications-intercom`.
