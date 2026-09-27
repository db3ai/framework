# In-app messages

`@db3.ai/app/in-app` provides `app().inApp`: a durable recipient inbox usable
directly or through `app().notifications`. It accepts typed content with a required
plain-text fallback and optional rich HTML body, persists one item per recipient and supports scoped inbox
queries, unread counts, banner queries and independent read/dismiss/archive state.

This first implementation is a server service. It does not yet include HTTP route
registration, a packaged browser client, mark-all-read, preferences or push
delivery. The notification coordinator supports application-owned `toInApp()` and
`toMail()` renderers, but does not yet persist a generic channel outbox. `presentation` records UI intent;
it does not display a banner or toast by itself.

## Install storage

Add `InAppRecord` to the application's existing `server/database/models.ts` registry:

```ts
import { InAppRecord } from '@db3.ai/app/in-app';

// Include alongside the existing Auth and application models.
export const notificationModels = [InAppRecord];
```

Generate/review a committed migration with `db3 db:make-migration add_in_app_messages`, then apply it
with `db3 db:migrate`. The App service getter never creates tables. Tests may use
`await application.db.install(UserIdentity, InAppRecord)` on a disposable database.
The service uses ActiveRecord's active connection and joins an outer
`application.db.transaction(...)` through a savepoint; outer rollback removes
accepted inbox items too. No `db` argument is propagated through normal calls.

## Send from trusted application code

```ts
import { app } from '@db3.ai/app/server';

const results = await app().inApp.send(
	userId, // Or an array of user IDs.
	{
		title: 'Your content plan is ready',
		body: 'Open the planner to review your articles.',
		bodyHtml: '<p>Open the planner to review your <strong>articles</strong>.</p>',
		severity: 'success',
		presentation: 'banner',
		action: { label: 'View plan', href: '/app/planner' },
	},
	{
		scope: { type: 'account' },
		type: 'content-plan.ready',
		key: completionId,
	},
);
```

See [sendReportReady.ts](./examples/sendReportReady.ts) for the executable
code-owned example. No notification class or template database is needed.

`send()` is a trusted producer API, usable by background jobs. Never expose it
as an unrestricted browser send endpoint. Application code authorizes the producer
and chooses recipients. The service verifies identities through the App's configured
Auth identity model and checks recipient eligibility for the scope. It accepts at
most 100 input IDs, deduplicates canonical recipient identities, returns an empty
array for no recipients and accepts a batch atomically. Invalid or unavailable
recipients cannot leave a partially accepted batch.

Each result is `{ userId, id, status: 'created' | 'existing' }`. Acceptance means
database persistence, not display. `key` identifies an occurrence within recipient,
scope and `type`; retries return the existing ID without resetting read/dismissal
state. Different content under the same key raises `InAppError` with code `conflict`.
Omit the key for a new occurrence every time. Concurrent sends serialize by locking
recipient identity rows in stable order; a unique stored hash backs deduplication.
Applications sharing those rows in larger transactions must follow consistent lock
ordering and retry the entire domain transaction on database deadlocks or stale-snapshot
errors (including MariaDB ER_CHECKREAD). The service must not retry a fragment of an
outer transaction or claim acceptance when that transaction failed.

Content is copied and validated before writes. Titles, fallback bodies and labels are
plain text. `bodyHtml` optionally carries richer application-authored content. The
framework validates its length but does not sanitize it because each application owns
its permitted markup; every renderer must sanitize it before interpreting HTML. The service allows root-relative or credential-free HTTP(S) actions
and rejects unsafe schemes, protocol-relative URLs, whitespace and backslashes.
Renderers must use text-safe bindings; action destinations enforce their own access.
This is URL-scheme validation, not an application-specific trusted-host allowlist.

## Authenticated inbox

Authenticate the request using the existing framework Auth flow in an isolated
`RequestContext`. Then call the service without a client-supplied reader ID:

```ts
const page = await app().inApp.inbox({
	scope: { type: 'account' },
	limit: 25,
});

await app().inApp.update(itemId, 'read', { type: 'account' });
await app().inApp.update(itemId, 'unread', { type: 'account' });
await app().inApp.update(itemId, 'dismiss', { type: 'account' });
await app().inApp.update(itemId, 'archive', { type: 'account' });
```

`page` contains `items`, the whole scoped/unarchived `unreadCount` and `nextBefore`.
Supply `before: page.nextBefore` for another page. Limits range from 1 to 100.
The ordering uses descending ULIDs for stable pagination, not a commit-order
event cursor or snapshot. Refresh the first page to discover new arrivals; counts
and pages may change as concurrent actions occur.

`view: 'banners'` returns only undismissed/unarchived banner items. All views keep
the same inbox-wide unread count. Reading a page changes no state. Reading an item
does not dismiss its banner; dismissal does not mark it read or archive it. Archive
removes the item from active inbox/banner queries. Repeat state changes preserve the
first timestamp, except explicitly marking unread clears `readAt`. Rendering clients
must not replay stored toast items as fresh live alerts when loading an inbox.

Inbox operations require active request authentication. Unknown and foreign item IDs
produce the same `not_found` error. Hosts should map `InAppError.code` appropriately:
`invalid` to 400, `unauthenticated` to 401, `forbidden` to 403, `not_found` to 404 and
`conflict` to 409. Ordinary storage failures should remain server errors.

## Organization and other application scopes

Account ownership is built in. Other scopes fail closed unless configured:

```ts
const application = new App({
	inApp: {
		/** Checks current application membership and restrictions for every operation. */
		async authorizeScope(userId, scope, operation) {
			if (operation === 'update' && isReadOnlySession()) return false;
			if (scope.type === 'account') return true;
			return scope.type === 'organization' && await isMember(userId, scope.id);
		},
	},
});
```

The policy functions above are application-owned. The framework invokes the policy
for `receive`, `read` and `update`. When supplied it also governs account scopes,
allowing read-only impersonation restrictions. Background producers must supply a
policy that can check recipients without relying on a logged-in request. Checking
scope identifiers from headers alone is not authorization.

`InAppRecord` is a persistence model, not an authorized HTTP interface. Do not expose
its unrestricted query/update APIs to clients. It uses opaque recipient identifiers
rather than a foreign key to a hard-coded users table; application account-deletion
and retention workflows must remove the corresponding records. Its table belongs in
the same transactional database as the configured identity model.

## Committed change notifications

`InAppOptions.onChanged(userId)` is an optional application-owned invalidation
hook. `send()` calls it for newly created recipients; `update()` calls it after a
changed row. Reads and deduplicated sends do not trigger it. Surrounding Knex
transactions/savepoints defer the callback until commit; rollback suppresses it.
Use the service APIs: direct model writes do not invoke this hook.

```ts
const application = new App({
	inApp: {
		/** Sends an empty signal; the browser reloads its authorized HTTP inbox. */
		async onChanged(userId) {
			await application.webSockets.channel(`user:${userId}:notifications`).publish('changed', {});
		},
		/** A push failure cannot undo a committed notification. */
		onDeliveryError() { reportNotificationPushFailure(); },
	},
});
```

`reportNotificationPushFailure` is application-owned logging. Configure the
WebSocket HTTP receiver and worker publisher for cross-process delivery and register
a recipient-only channel policy. No WebSocket dependency is enabled automatically.
The hook is best effort and not a durable outbox. A crash between commit and the
callback can lose a signal; initial load, reconnect and manual refresh retrieve
saved inbox state. Callback errors do not reject durable message acceptance.

## Ownership and verification

This service depends on DB/ActiveRecord, Auth and the active App context. Public
contracts are in `contracts/`; `@db3.ai/app/in-app/contracts` is type-only and can be
used by browser TypeScript without importing server implementation.

Run `npm run test:service --workspace @db3.ai/app -- in-app` with local test DB
credentials configured as described in the package README. Tests create and remove
real disposable databases; missing SQL is a failure, not a skipped pass. They cover
concurrent retry acceptance, aliases, conflict rollback, outer transaction rollback,
old transaction snapshots, recipient/scope isolation, state independence and pagination.
Public changes also require `npm run check --workspace @db3.ai/app` and
`npm run framework:package:test` for packed runtime and TypeScript consumer checks.

The starter application includes app-owned authenticated HTTP routes, an unread badge,
paginated inbox, persistent banners and a demo toast. Open the inbox or use Refresh
to retrieve current state; websocket delivery is not connected to this demo yet.
