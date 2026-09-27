# WebSocket endpoints

`@db3.ai/app/websocket` provides `app.webSockets` and controller-style JSON
endpoints on the existing HTTP/S server. It uses framework Auth, with a fresh
RequestContext for each action and server send. No new database tables are needed.
It depends on Auth, Server and `ws`; the Fastify adapter is optional. The browser
subpath uses the native WebSocket API and imports no server runtime.

## Define and mount an endpoint

```ts
import Fastify from 'fastify';
import { App } from '@db3.ai/app/server';
import { defineWebSocket } from '@db3.ai/app/websocket';
import { registerWebSockets } from '@db3.ai/app/websocket/fastify';

const application = new App(); // Use your existing configured application.
const server = Fastify();
const userEndpoint = defineWebSocket({
	/** Runs after this connection authenticates. */
	async open({ userId, send }) {
		await send({ type: 'hello', userId });
	},
	/** Validates untrusted input and supplies the message action's inferred type. */
	parse(data: unknown): { text: string } {
		if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string') throw new Error('Expected text.');
		return { text: data.text };
	},
	/** Handles one validated command at a time for this socket. */
	async message({ send }, data) {
		await send({ type: 'echo', text: data.text });
	},
});
registerWebSockets(server, {
	app: application,
	origins: ['https://app.example.com'],
	endpoints: { '/ws/me': userEndpoint },
});
server.addHook('onClose', async () => { await application.close(); });
await server.listen({ host: '127.0.0.1', port: 8001 });
```

Definitions can live in controller files and be imported into the endpoint map.
Paths are exact; file discovery, dynamic route parameters and HTTP middleware
execution are not part of this module. `request.url` exposes query parameters.
For a plain Node HTTP/S server use `application.webSockets.mount(server, options)`;
close the WebSocket service **before** awaiting HTTP server shutdown. The Fastify
adapter does this in `preClose`, and `App.close()` also closes the service before
clearing application context or closing the database.

The [user endpoint example](./examples/userEndpoint.ts) includes command validation
and private presence access. Tests execute it through the public exports.

## Browser client

```ts
import { WebSocketClient } from '@db3.ai/app/websocket/client';

const url = new URL('/ws/me', window.location.href);
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
const client = new WebSocketClient({
	url: url.href,
	/** Return the current bearer session from the application's existing Auth store. */
	token: () => authStore.token,
	/** Validate your application payload before assigning it to a store. */
	onMessage(data) { handleMessage(data); },
	onState(state) { connectionState.value = state; },
});
client.connect();
client.send({ text: 'Hello' }); // false until authenticated; nothing is queued.
// On logout/component ownership disposal:
client.close();
```

Own the client once per desired endpoint/SPA lifecycle. Imports are safe during
SSR; the native constructor is resolved only when connecting. Messages remain
`unknown` until the application validates them. There is no snapshot protocol,
replay, Pinia dependency or automatic store update. `open` may send ordinary
application data if desired. When a token changes, close and reconnect explicitly.

The client automatically retries transient closure (including 1001 during a
deployment) with jittered exponential backoff up to 30 seconds. Authentication,
authorization and protocol errors stop retries (`denied`); call `connect()` after
repairing credentials. No offline writes are queued or repeated. An HTTP upgrade
rejection appears as a generic network failure in browsers, so it follows the
transient retry policy; inspect server/proxy configuration if this persists.

## Authentication and authorization

The first frame is `{ "type": "authenticate", "token": "..." }`. The token is
the existing framework bearer session, held in memory for the connection and
never placed in URLs or subprotocols. Use **WSS/HTTPS in production**, and do not
log frames or credentials. Cookie applications supply `resolveToken(request)` at
mount time and use browser client `auth: 'cookie'`. The resolver reads the existing
HttpOnly session cookie on the server; it replaces (never falls back to) the frame
token. No readable cookie or ticket endpoint is needed. Configure exact allowed
origins; missing/foreign origins are rejected, including for public endpoints.

Use `defineWebSocket({ auth: 'public', ...actions })` and client `auth: 'public'`
for an explicitly anonymous endpoint. Its first frame is `{ "type": "connect" }`.
Both `context.user` and `context.userId` are null, even when the browser has a
session cookie. Omitted auth always requires authentication. Public endpoints
still have origin, heartbeat, payload and connection limits; applications must
add appropriate abuse controls before opening anonymous writes to the internet.

After authentication the server sends `{ "type": "ready" }`. Application frames
in both directions are `{ "type": "message", "data": ... }`. The library hides
these envelopes from controller and browser callbacks. Text JSON is supported;
binary frames and malformed messages close the connection. `send()` returning true
means accepted into the local transport, not that the browser processed it.

Every `open`/`message` action runs with the authenticated user in framework Auth.
`context.send()` and heartbeat checks also revalidate the session and optional
`authorize(context)` policy. Authorization must be a pure access decision and
must not send data. Apps own resource/tenant checks and mutation permissions,
including read-only impersonation. Fastify HTTP hooks are bypassed by upgrades;
do not assume existing HTTP billing or tenant middleware protects these actions.

Auth currently records session/account activity on authentication, so these fresh
checks perform database reads and writes. This deliberately prioritizes existing
Auth semantics over adding a second session cache in this first implementation.
Permission checks fail closed. Idle revocation is detected on the next heartbeat
(30 seconds by default), plus query time; a pending check is terminated if it
has not settled by the following heartbeat. Already-running actions may finish.
Use `context.signal` to cancel application work and `close({ id, userId, code })`
to dispose listeners. Close callbacks run without authenticated request context.
They must settle promptly; shutdown is bounded even if application work hangs.

## One connection, multiple authorized channels

Own one `WebSocketClient` per browser tab at app startup and share it across
features. Register private channel policies on one authenticated endpoint:

```ts
import { defineChannel, defineWebSocket } from '@db3.ai/app/websocket';

const endpoint = defineWebSocket({
	channels: [
		defineChannel('website:{websiteId}:jobs', {
			/** Application helper queries current organization and website membership. */
			authorize: ({ userId, params }) => canAccessWebsite(userId, params.websiteId),
		}),
	],
});
// Mount endpoint at /ws through registerWebSockets using your existing app.
```

`canAccessWebsite` is your application's access helper, not a framework method.
The [resource channels example](./examples/resourceChannels.ts) accepts this
policy as a function and also demonstrates private account notifications.
Authentication alone never grants website access. Parameters match whole
colon-delimited segments. Unknown or ambiguously matched channels are denied.
Every subscription and delivery checks the current session, endpoint policy and
resource policy. Revoked membership removes the subscription before sending the
payload. Anonymous endpoints cannot subscribe to these private channels.

```ts
// After saving the new job state, in the same API process:
await application.webSockets.channel(`website:${websiteId}:jobs`)
	.publish('completed', { jobId });
```

```ts
const realtime = new WebSocketClient({
	url: websocketUrl, // Absolute ws(s) URL for /ws.
	token: () => authStore.token,
	/** Reload authorized HTTP state after subscribing, including reconnect. */
	onSubscribed: channel => reloadChannelState(channel),
	onChannelDenied: channel => showAccessDenied(channel),
});
realtime.connect();

const unsubscribe = realtime.channel(`website:${websiteId}:jobs`)
	.on('completed', data => {
		// Payloads are unknown: validate with your application's schema.
		const event = jobCompletedSchema.parse(data);
		refreshJob(event.jobId);
	});
// Component disposal removes this listener only:
unsubscribe();
// App logout disposes the shared connection:
realtime.close();
```

The first listener subscribes; removing the final listener unsubscribes. Each
registration owns its cleanup, including identical callbacks. Connections are
not shared across separate tabs/devices. A reconnect restores remaining
subscriptions and reruns access checks. `onSubscribed` is the place to reconcile
saved state; events have no history or replay guarantee. `onChannelDenied`
reports rejected subscriptions without closing unrelated channels. To retry a
denied subscription after permissions change, remove its listeners and add them
again, or reconnect. On logout, also dispose user-owned feature listeners before
reusing the client with another account. At most 128 channels may be subscribed
per connection. Channel and event names are limited to 256 characters.

Publishing returns accepted local sends, not browser delivery receipts. Configure authenticated HTTP publication below for separate job workers.
Public subscription policies are not provided by this API. Existing explicit public endpoints remain available.

## Push from separate workers

Use the existing API as an authenticated HTTP receiver. No broker service is
required. In the API's Fastify registration, add an explicit private route and a
dedicated random service secret (32–256 URL-safe characters):

```ts
registerWebSockets(server, {
	app: application,
	origins: ['https://app.example.com'],
	endpoints: { '/ws': endpoint },
	publish: { path: '/_internal/realtime/publish', token: process.env.REALTIME_SECRET! },
});
```

Configure the worker App with the receiver's trusted URL and the same secret:

```ts
const application = new App({
	webSockets: {
		publish: {
			url: 'http://api:8001/_internal/realtime/publish',
			token: process.env.REALTIME_SECRET!,
		},
	},
});
// Publish after the authoritative outer transaction commits:
await application.webSockets.channel(`website:${websiteId}:jobs`)
	.publish('completed', { jobId });
await application.close();
```

Mounted APIs deliver directly to local sockets, even if configured with the same
outbound publishing options as workers. The HTTP receiver also delivers locally
and never relays recursively. Every send still validates the browser's session
and channel access. Without outbound configuration, publication is process-local.

The Fastify adapter owns HTTP registration; a plain Node host must provide its
own authenticated receiver. No startup subscription or readiness dependency is
introduced. Keep the publishing route on a private listener/network, and use
HTTPS when traffic crosses an untrusted network. The service bearer secret never
belongs in browser code or URLs. The receiver rejects Origin-bearing browser
requests and invalid credentials before parsing the JSON body.

The receiver validates channel/event names and limits bodies to 64 KiB. Worker
requests have a five-second deadline (`timeoutMs` can override it), do not follow
redirects, and do not retry automatically. Non-success responses reject without
including their response body or credentials in the error. Publishing returns
accepted local sends, or zero after remote HTTP acceptance; it is not a browser
delivery receipt.

One configured URL reaches one API process. During blue/green replacement, route
worker requests to the active API and close old sockets so browsers reconnect and
reload authorized state. A load balancer alone does not broadcast to all replicas.
Multiple concurrent socket owners require explicit fan-out. Presence and
lower-level `channels.publish()` memberships remain process-local.

There is no durable replay. A crash between commit and publication, an HTTP
failure, or a disconnect may lose a signal. Reload saved state after subscription
and reconnect, and provide explicit refresh. Retrying an ambiguous timeout can
duplicate events; prefer idempotent state invalidations. Guaranteed delivery
requires an outbox.

For inbox integration, set `inApp.onChanged` to publish a recipient invalidation.
InApp defers this callback until the surrounding transaction commits and reports
callback failures through `inApp.onDeliveryError` without undoing saved messages.
Generic channel publication is not transaction-aware: call it after the outer
transaction returns.

## Presence and local subscriptions

`application.webSockets.channels.join(name, context)` joins an accepted connection
from a trusted controller action and returns an idempotent leave function. It
automatically leaves on disconnect. `channels.publish(name, data)` fans out to
local members and returns the number of accepted sends, not delivery receipts.
Every send rechecks session and endpoint authorization. This lower-level API has no browser-controlled membership. For browser
subscriptions use the authorized channel definitions above.
For private notifications, choose `inbox:${context.userId}` on the server, commit
the in-app message, then publish an invalidation to that user's channel. The
browser reloads the authorized HTTP inbox, including after reconnect. InApp has no automatic WebSocket dependency. Configure its `onChanged` callback
to publish an invalidation after committed service writes.

The starter's Live rooms demo implements three endpoint policies: a public lobby,
signed-in members, and a studio requiring an explicit database grant. Its
application controller serializes each room's joins and edits, sends saved history
before live membership, and owns tab-level guest presence and cursor broadcasts.
The whiteboard stores at most 500 strokes of 200 points, plus 50 recent chat
messages, in SQL. A refresh reloads that state; no transport replay is promised.
This demo writer is single-process, not a distributed collaborative document engine.

`application.webSockets.presence('/ws/me')` returns `{ userId, connections }[]`
for authenticated users on that endpoint in this process. Tabs/devices share a
user entry while retaining separate connection counts. Presence is approximate;
dead peers disappear after heartbeat detection, not immediately on network loss.
Presence means connected, not actively looking at the page.

Presence is a server API. It is not broadcast automatically because listing other
users is an application permission decision. A private endpoint can send only the
current user's entry, as the example does. Shared rooms must authorize membership
and filter presence by application scope; endpoint paths alone do not create
tenant isolation, and query strings do not partition this presence list.

`onPresence(path, listener)` observes local changes and returns an unsubscribe
function. For example, an `open` action can push only its account's presence:

```ts
import type { WebSocketContext } from '@db3.ai/app/websocket';

/** Sends local presence changes for this user and removes the listener on disconnect. */
async function open({ userId, send, signal }: WebSocketContext) {
	/** Re-reads current counts; send rechecks the recipient's session and endpoint policy. */
	function changed() {
		void send({ type: 'presence', users: application.webSockets.presence('/ws/me').filter(item => item.userId === userId) });
	}
	const unsubscribe = application.webSockets.onPresence('/ws/me', changed);
	signal.addEventListener('abort', unsubscribe, { once: true });
	changed();
}
```

Presence listeners execute without Auth context and do not supply event history.
Asynchronous listeners are not serialized. Read current presence when handling
each signal and keep callbacks short; errors go to the configured `onError`.

An `open` action can retain `context.send` in an application-owned subscription
and remove it on `context.signal` abort or `close`. Every later send rechecks
access. These callbacks and presence belong to the current process. A separate
worker cannot reach these retained callbacks or lower-level memberships. Use
named channel events with the HTTP configuration above for cross-process push.

## Blue/green deployment

The Auth session lives in the shared database while sockets live in an API
process. Route new upgrades to green, then initiate graceful shutdown on blue.
Blue closes sockets with 1001; clients reconnect to green using the same token.
Until old connections drain, each process has only its own presence list and
subscriptions. HTTP publication reaches the API selected by its URL; events sent
only to green do not reach sockets still on blue.
Deployments must close old sockets instead of leaving them alive indefinitely.
There is no guaranteed delivery across disconnects; applications reload needed
state themselves after reconnecting.

The existing reverse proxy must forward WebSocket upgrades on the endpoint path
and allow idle timeouts longer than the heartbeat interval. No extra public port
or shared socket/session service is required. This module cannot change proxy
routing or implement distributed presence for you.

## Limits and verification

Defaults: 1000 sockets including pending authentication; 5-second authentication
deadline; 64 KiB incoming/outgoing frames; 256 KiB outgoing buffer; 16 queued
incoming actions; 30-second heartbeat; 3-second shutdown deadline. Compression
is disabled. Slow clients, flooding and oversized payloads are disconnected.
Configure `onError` for server diagnostics; application errors close with 1011
without sending exception text. Proxy rate limits remain application operations.

Run `npm run test:service --workspace @db3.ai/app -- websocket` using the configured
disposable MariaDB test setup. Tests use real sockets and Auth records, cover
isolation/revocation, validation, presence, cleanup and reconnect across API
replacement. Run `npm run check --workspace @db3.ai/app` and
`npm run framework:package:test` for examples and packed-consumer verification.

This module uses the existing-server, heartbeat and bounded transport mechanisms
described in the [ws documentation](https://github.com/websockets/ws/blob/master/README.md).

## Shared board and durable loading recipe

The [WebSocket guide](https://db3.ai/docs/realtime-kanban) composes seven
copyable application examples with real Auth, SQL, Queue, WebSockets and Pinia:

- [LiveBoard](./examples/board/LiveBoard.ts) saves authorized card moves under a
	row lock, rejects stale revisions and emits `changed` after commit.
- [Public snapshot](./examples/board/boardSnapshot.ts) excludes membership and
	validates the browser projection. [HTTP routes](./examples/board/registerBoardRoutes.ts)
	derive identity from the authenticated session.
- [Pinia store](./examples/board/createBoardStore.ts) rejects stale responses and
	derives loading from persisted job status, including after a full reload.
- [Channel bindings](./examples/createChannelSync.ts) share one socket, reload
	after subscription acknowledgements and coalesce changes during an HTTP read.
- [Browser composition](./examples/board/createBoardClient.ts) owns the store and
	connection at app startup, with explicit logout cleanup.
- [Summary job](./examples/board/SummarizeBoardJob.ts) executes independently of
	the browser, persists completion/failure and publishes through the HTTP bridge.

These are app-owned recipes, not automatic ORM subscriptions or a framework
Pinia dependency. Install Vue/Pinia in the consuming frontend. Register the
model with the host's migrations and the job with each worker. The recipe uses
the database queue driver on the same database so loading and dispatch commit
atomically. Call its mutation methods outside an outer transaction. It keeps
one active/latest summary per board, not an unlimited run/idempotency history.
The sample summary is quick; replace that calculation with the actual work.
Long external operations still need lease fencing, provider idempotency and
server-side reconciliation of abandoned runs and failed completion hooks.

Run `npm test --workspace @db3.ai/app -- src/websocket/tests/examples/liveBoard.test.ts`
with disposable MariaDB credentials. It tests real two-user Pinia synchronization,
conflicts/denial, reload/reconnect, SQL dispatch rollback, worker HTTP publication,
terminal failure, stale-run fencing and listener cleanup. There is no timed inbox
or board polling. HTTP publication remains best effort: if it fails while a
client stays connected, that client needs explicit/focus/reconnect refresh.
Guaranteed eventual notification requires a durable outbox, not only a socket.

### Presence, Yjs and AI boundaries

Endpoint `presence(path)` does not enumerate named-channel subscribers. A shared
endpoint needs app-owned document-view/leave actions and per-document ephemeral
presence, including route departure, multiple tabs, access checks and heartbeat
cleanup. The starter rooms already demonstrate room presence and saved chat.

Yjs uses binary updates and a synchronization/awareness protocol. Existing Yjs
providers do not speak this service's JSON envelopes. Reusing one connection
requires an adapter, bounded encoding, state-vector recovery, persistence and
awareness cleanup. No Yjs adapter is shipped or tested here. See
[Yjs updates](https://docs.yjs.dev/api/document-updates) and its
[WebSocket provider](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket).

`Agent.queue()` executes on the worker independently of a browser, but queued
runs currently discard the live event sink. There is no durable token log or
replay cursor. Reconnectable AI viewing needs saved cumulative checkpoints or
ordered events, authorized recovery, duplicate/gap handling and attempt fencing.
The guide explains these design boundaries without advertising a replay API.


## Task tutorials

Start with the [main WebSocket guide](https://db3.ai/docs/websocket) for shared
connection ownership, authorized channels, worker HTTP publishing and recovery.
Then follow the tutorial for the feature you are building:

- [Document presence](https://db3.ai/docs/realtime-presence)
- [Saved-action alerts](https://db3.ai/docs/realtime-actions)
- [Shared Kanban and Pinia](https://db3.ai/docs/realtime-kanban)
- [Durable background-job loading](https://db3.ai/docs/realtime-jobs)
- [Chat rooms](https://db3.ai/docs/realtime-chat)
- [Deployment progress](https://db3.ai/docs/realtime-deployments)
- [Yjs adapter design](https://db3.ai/docs/realtime-yjs)
- [Reconnectable AI design](https://db3.ai/docs/realtime-ai)
- [Approval requests](https://db3.ai/docs/realtime-approvals)
- [Upload processing](https://db3.ai/docs/realtime-uploads)
- [Inventory updates](https://db3.ai/docs/realtime-inventory)
- [Permission changes](https://db3.ai/docs/realtime-permissions)

The deployment tutorial supplies a tested
[public projection](./examples/deploymentSnapshot.ts) and
[authorized environment channel](./examples/deploymentEndpoint.ts). The projection
rejects stale/wrong-resource responses and requires passed health plus the intended
active release before displaying live. It validates controller assertions; it does
not perform infrastructure probes, execute deployments or provide a Cloud API.
