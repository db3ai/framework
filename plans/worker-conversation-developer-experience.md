# Threaded chat with optional workers: proposed developer experience

**Draft — proposed API design, not an implemented tutorial.**

This guide shows the intended experience after the AI run socket relay is built.
It is discussion material and is not part of the published framework docs. Code
using the proposed APIs below cannot run against the current package. Keep the
guide beside executable examples and tests in the AI service once implemented.

The application defines an agent, authorizes a conversation, and renders a chat.
The framework manages execution, saved history, streaming, attachment,
cancellation and transport cleanup. This guide uses queued execution observed as
live chat. A browser connection never owns execution.

## Primary objective: push Stop to the active AI execution

The first implementation removes the need for repeated SQL cancellation checks
on socket-connected AI runs. Preserve Scout's working queue admission, history,
streaming, reconnect, notifications and controller APIs. The run handle and browser
convenience helper are optional later improvements, not prerequisites for Stop.
Do not make this a general queue rewrite, worker registry or Cloud integration.

### Current baseline to release independently

The current implementation commits conversation cancellation and pending-turn
cancellation before notifying listeners. A local recorder responds immediately
through its existing stop listener; a recorder in another process observes saved
state at a persistence checkpoint or through its five-second timer. That timer
runs for every active recorder, even when output is arriving; it is not limited
to genuinely silent providers. Its callback explicitly restores the normal App
database scope instead of using a closed admission transaction.

Keep this behavior in the release before the transport change. Review, test and
commit framework source first, capture the exact Scout snapshot, then verify the
combined committed Scout release. An unrelated unfinished feature must not enter
a deployment merely because it shares the working tree. The proposal itself adds
no production socket endpoint or new agent API.

### Smallest implementation sequence

1. **Add an optional framework-owned run socket.** Each active remote AI attempt
   opens one outbound connection to the API's private endpoint. Service auth and
   a durable ownership check bind conversation, root request and exact writer
   attempt. The worker exposes no listening port. Runs inside the API process
   keep their local path. Build on the existing shared browser socket. Worker
   service authentication must not reuse browser session checks that introduce
   a new SQL read for every stream frame.
2. **Connect Stop to that socket.** Extend the central conversation control path
   after its transaction commits. Signal the exact bound execution, which aborts
   its existing recorder signal. That signal already reaches the SDK. Keep REST
   Stop as the public control entry point; a browser socket command is unnecessary
   for this milestone. This also covers trusted callers such as website pause.
3. **Use the same run socket for AI updates.** Route the existing normalized and
   authorized projections to browser channels. Retain current bounded buffering
   and saved-message correction. Preserve notification/attention invalidations;
   non-AI publishers can continue using the existing HTTP publication bridge.
4. **Prove failure behavior before removing the timer.** Initially retain the
   five-second fallback while exercising the new path. Cover no viewers, silent
   providers, Stop during connection establishment, disconnect/reconnect, API
   replacement, rollback, duplicate commands and late commands from old runs.
5. **Disable periodic Stop SQL checks for the proven socket path.** A connected
   run uses in-memory signalling; reads occur at binding/rebinding and existing
   persistence/ownership boundaries. Keep the legacy polling path explicit for
   deployments without the socket transport until its retirement policy is
   agreed. Do not silently advertise all worker configurations as polling-free.
6. **Add convenience APIs separately if useful.** A richer run handle and
   `createAgentChat` can reduce integration code later. Preserve `.queue()` and
   completion-awaiting `.run()`; neither is required to deliver Stop promptly.

### Delivery and race contract

- SQL cancellation is authoritative and survives API restart; the socket is a
  low-latency wake-up. Sending a frame alone is never the durable decision.
- Binding/rebinding installs the local routing/listener state before a final
  durable state check, so Stop cannot fall between checking and registering.
  A cancelled run must not start or resume provider work during attachment.
- A command identifies the exact execution and is safe to repeat. A receipt means
  the worker observed the control, not that all external side effects have ended.
  An acknowledgement deadline must recover/rebind a suspect connection rather
  than leave a connected-looking worker unaware indefinitely.
- A lost frame or API failure after commit is recovered by reconnecting and
  checking durable state once. No in-memory pending command is the sole record.
- When the relay is unavailable, an already-running agent may continue saving
  work; Stop is discovered on a persistence checkpoint or successful reattachment.
  Without periodic reads, an isolated silent provider cannot be stopped instantly.
  Provider/tool deadlines remain separate bounds; do not equate five-second
  cancellation polling with an operation timeout or abort just because a browser
  disconnects.
- SDK cancellation does not automatically interrupt arbitrary application tools.
  Audit tool operations that only use their own timeout signals, including PDF
  reads, and expose/combine the runtime signal where prompt interruption matters.
  Do not claim socket delivery forcibly ends already-started remote side effects.
- Retained `RunnableJob` has its own ten-second lifecycle heartbeat; ordinary
  `AgentRunJob` extends `QueueableJob` and does not inherit it. Do not replace the
  recorder timer by assuming a heartbeat that is absent. Queue reservation,
  provider deadlines, transient flush timers and socket ping/pong have independent
  responsibilities and stay outside this Stop-only change.
- Cleanup closes run sockets, timers/listeners, routing entries and outstanding
  acknowledgements on completion, cancellation, failure and shutdown. Blue/green
  replacement must disconnect old relay bindings and reconnect through the stable
  private gateway; both proxy hops need WebSocket Upgrade support.

### Preserve the future Cloud boundary

Keep conversation commands, safe identifiers and stream events independent of
Fastify, SQL models and a particular queue driver. A future Cloud host can expose
the same REST/socket protocol, but needs its own tenant credentials, agent-code
hosting or application-worker model and durable job-delivery contract. Do not add
Cloud infrastructure or Redis to this local Stop milestone. One active API relay
is the initial supported topology; multi-API routing is a separate capability.

## The experience in a few lines

A normal controller action queues an agent and returns its run handle:

```ts
const run = await new HelpAgent({ user, scope, conversationId })
	.input(message)
	.queue();
return run;
```

`queue()` admits work immediately. Its proposed richer return value identifies
that work and optionally manages it; returning or serializing the handle does
not start it a second time. Its `toJSON()` exposes only the existing admission
identifiers. No response descriptor, special controller response handler or
separate chat wrapper is needed. The full HTTP example below also forwards the
client's submission key, which is essential for retry-safe admission.

### Queueing, reopening and retrying are different operations

| Operation | Result |
| --- | --- |
| Queue with omitted or null conversation ID | Creates a conversation and its first turn/job. |
| Queue with an existing authorized conversation ID | Adds a new turn/job to that conversation. |
| Queue during an active turn | Admits a FIFO followup; does not create a second active writer for that conversation. |
| Repeat a submission with the same key and payload | Returns the existing admission; does not create another turn/job. |
| Open an existing conversation in the browser | Loads saved history and subscribes; creates no turn/job. |
| Reconnect a browser socket | Reauthorizes, subscribes and reconciles saved state; creates no turn/job. |
| Supply a nonexistent or unauthorized conversation ID | Rejects the request; never silently creates a replacement conversation. |

Use null/omission for a new conversation. The HTTP schema rejects an empty string
or whitespace-only ID, even though today's low-level resolver treats a falsy ID
as absent. A conversation ID is not an idempotency key. Identical message text is
also not proof of a retry; the user may intentionally send it again.

The worker processes are started by deployment. `queue()` creates a job for one
of them to claim; it does not launch a new worker process. Each active AI attempt
opens its optional run socket. A conversation can have many turns over time,
handled by different workers, while the browser keeps observing the same thread.

The browser works with a conversation, not a job:

```ts
// createAgentChat is proposed; the returned conversation methods already exist.
const chat = createAgentChat({ baseUrl: '/api/chat', socket: sharedSocket, headers: authHeaders });
const unsubscribe = chat.onChange(renderChat);
await chat.open(conversationId); // Restore an existing thread and attach to updates.
await chat.send('How does this work?'); // A new instance can send without open().
await chat.stop(); // Cancel the active turn and queued followups.
await chat.send('Continue with a shorter answer.'); // Start a new turn in this thread.
unsubscribe();
chat.close(); // Release the viewer; do not stop server execution or the shared socket.
```

These calls illustrate separate user actions, not a script to execute sequentially.

## Existing foundation and proposed additions

| Surface | Status and responsibility |
| --- | --- |
| `Agent`, `Agent.run`, `Agent.stream`, `Agent.queue`, `AgentRunJob`, `registerQueuedAgent` | Existing: direct completion/streaming and separate durable queue admission. Their return values and lifetimes currently differ. |
| Conversation snapshot/history/stop services | Existing: authoritative saved state and separate read/stop policies. |
| `createAgentConversation` and its `open`, `send`, `retrySend`, `stop`, `loadOlder`, `refresh`, `close` methods | Existing: browser conversation state and recovery. |
| Shared `WebSocketClient` and authorized channels | Existing: one browser connection shared across features. |
| `ai.streaming.transport` | **Proposed:** configure the optional socket used by an active agent execution. |
| `AgentRunHandle` returned by `Agent.queue()` | **Proposed:** retain admission identifiers and safe JSON, with optional explicit `status()` and run-specific `cancel()` methods. |
| `createAgentChat` from `@db3.ai/app/ai/client` | **Proposed:** compose the existing HTTP/conversation client with a shared socket, removing repeated application adapter code. |

The run handle delegates to AI execution services and has no socket or task
lifecycle of its own. The browser helper composes the existing conversation state
machine and HTTP/socket adapters. The first transport implementation uses one
active API hub and one optional private socket per remote AI execution. Queued
mode initially uses the existing SQL queue. Redis and a worker registry are out
of scope.

Direct `Agent.run(message)` and `Agent.stream(...)` retain their existing
completion-awaiting behavior, history and stream recording. This queue-based
chat guide does not add a second App-owned background executor or change their
return timing. Designing a direct HTTP streaming example is separate work; do
not claim swapping `.queue()` for `.run()` preserves prompt admission responses.

## 1. Prerequisites

Start from an application with framework App bootstrap, Fastify, authenticated
users, Vue and Vue Router. This example is a private help chat: each user owns
their threads, with `scopeId` equal to that user's ID. An organization application
must instead resolve an authorized organization and check current membership.

Register the existing AI models in the application's migration registry and
apply committed migrations: `AiConversation`, `AiMessage`, `AiRequest`,
`AiRateLimitBucket` and `AiRateLimitReservation`, alongside the application's Auth
models. Queued mode also needs `QueuedJob` and `FailedJob`, with the same schema
and agent registration in API and worker processes. Direct mode does not require
queue tables or agent serialization registration. Do not create tables at startup.

Keep model/provider configuration on the server. The examples assume the app's
configuration loader provides an AI API key and model, exact browser origin,
private relay URL and a server-only random relay secret. No provider or relay
credential belongs in a browser bundle, query string or chat message.

## 2. Define the agent

`server/agents/HelpAgent.ts`:

```ts
import { Agent, type AgentTool } from '@db3.ai/app/ai';

/** Answers help questions while the framework owns execution and transport. */
export class HelpAgent extends Agent {
	/** Supplies the behavior shared by every admitted turn. */
	async instructions(): Promise<string> {
		return 'Help the user understand this application. Be concise and ask when context is missing. Do not invent application capabilities.';
	}

	/** Adds application tools here; this minimal chat needs none. */
	protected tools(): AgentTool[] {
		return [];
	}
}
```

There are no socket calls, worker IDs or browser callbacks in this class. Real
tools use the framework's existing tool/context APIs. Tools that perform external
effects still own their idempotency and cancellation cooperation; a network
disconnect or Stop cannot undo an already completed external action.

## 3. Configure the app once

The following are additions to the app's normal bootstrap, not a replacement for
its database/Auth configuration. `config` comes from that server's configuration
loader. Run agent registration while the application is the active App.

```ts
import { App } from '@db3.ai/app/server';
import { AgentRunJob, registerQueuedAgent } from '@db3.ai/app/ai';
import { HelpAgent } from './agents/HelpAgent';

const application = new App({
	// Retain the application's normal database, Auth and other options here.
	ai: {
		apiKey: config.ai.apiKey,
		model: config.ai.model,
		streaming: {
			enabled: true,
			/** Restricts snapshots and every live delivery to the owner and agent. */
			authorize: (actor, conversation, view) => view === 'conversation'
				&& conversation.user === actor.userId
				&& conversation.scope === actor.userId
				&& conversation.agent === 'HelpAgent',
			// PROPOSED: sending requires an explicit policy, independently of viewing.
			/** Restricts new turns on existing threads to their owner and agent. */
			authorizeSend: (actor, conversation) => conversation.user === actor.userId
				&& conversation.scope === actor.userId
				&& conversation.agent === 'HelpAgent',
			/** Mutation permission is explicit even when this example allows its owner. */
			authorizeStop: (actor, conversation) => conversation.user === actor.userId
				&& conversation.scope === actor.userId
				&& conversation.agent === 'HelpAgent',
			// PROPOSED: the agent runtime creates a connection only while executing.
			transport: {
				driver: 'socket',
				url: config.agentRelay.url,
				token: config.agentRelay.token,
			},
		},
	},
});

// Only needed when controllers choose queued execution.
application.queue.registerJob(AgentRunJob);
registerQueuedAgent('HelpAgent', HelpAgent);
```

This configuration is shared by the API and worker bootstraps. With no socket
transport configured, an agent still executes and saves its conversation. With a
configured but temporarily unavailable relay, execution continues and the runtime
attempts bounded-backoff reconnection. No unbounded stream backlog is retained.

## 4. Write a normal controller action

`server/api/chat/send.post.ts` — existing queue admission syntax, with the
**proposed richer run handle** as the return value:

```ts
import { z } from 'zod';
import type { RouteContext } from '../../file-routes';
import { requireAuthenticatedUser } from '../_shared/auth';
import { HelpAgent } from '../../agents/HelpAgent';

/** Validates one intentional submission and its retry identity. */
const ChatMessage = z.object({
	message: z.string().trim().min(1).max(4000),
	conversationId: z.string().trim().min(1).max(128).nullable().optional(),
	idempotencyKey: z.string().trim().min(1).max(128),
});

/** Queues one authorized turn; returning its handle never starts another run. */
export default async function send(context: RouteContext) {
	const user = await requireAuthenticatedUser(context);
	const input = ChatMessage.parse(context.request.body);
	const run = await new HelpAgent({
		user,
		scope: user,
		conversationId: input.conversationId,
	})
		.input(input.message)
		.queue({ idempotencyKey: input.idempotencyKey });
	context.reply.code(202);
	return run;
}
```

`RouteContext` and `requireAuthenticatedUser` are application-owned routing/auth
helpers, not new framework exports. The auth helper must terminate unauthorized
requests and otherwise return a user with a string ID. The route host runs each
action in an isolated App request context and maps Zod validation errors to 400
and framework access errors to a non-disclosing 403/404 response. Quota and product
policy remain in this action or its application services before admission.

The existing agent accepts user/scope objects and normalizes their identities.
Private threads explicitly use `scope: user`; an organization application supplies
its authorized organization. Existing admission checks conversation ownership,
scope and agent identity. The proposed send policy must preserve those checks.

### Submission identity is still required

The browser client generates and retains `idempotencyKey` automatically for each
intentional send. The example explicitly passes it to the existing queue API;
application UI code never generates or manages it. Reopening a conversation does
not send this request at all.

A run handle cannot remove this admission requirement: it exists only after
admission, too late to protect an uncertain POST retry. We retain the explicit
queue option for this first implementation rather than make agent execution read
HTTP state implicitly. A future validated submission input overload could carry
this metadata without repeated controller mapping, but is not part of this guide.

A retry must use the same key, original conversation ID and payload, including
null for an initially new conversation. Changing the key creates a new logical
submission. Reusing a key with changed content is a conflict. Concurrent retries
must resolve to one admission. Low-level background callers may omit the key when
they deliberately want each call to create new work.

### Optional management through the returned handle

The following methods are proposed, not currently exported:

```ts
const run = await agent.input(message).queue();
const current = await run.status(); // One explicit read, not a polling subscription.
await run.cancel(); // Targets this run only, not a later turn in the conversation.
```

Call cancellation only when intended; the snippet demonstrates separate actions.
The handle retains `jobId`, `conversationId`, `aiRequestId` and `traceId`. Its
`toJSON()` returns exactly the safe admission shape already accepted by the
browser. Keep internal service references private and never serialize agent
context, credentials, prompts or methods. Verify Fastify serialization with the
actual route/schema configuration. Existing ordinary JSON responses need no new
controller response dispatch protocol.

The handle does not keep a database connection, open a socket, create a timer or
require disposal. Methods delegate on demand to the current App's services. A
stale handle may not cancel a newer turn. Run-specific cancellation must update
conversation FIFO state correctly and is new service work, not an alias for
conversation-wide Stop or a generic queue deletion. A terminal run's cancellation
must be harmless. A later process can resolve a handle by persisted run identity;
the exact lookup method and authorization boundary remain to be designed.

For background work, callers can ignore the handle. The job can save application
state and publish its domain notifications through the existing services. For
chat, return the handle and let the browser independently attach to its
conversation. AI streaming and notification payloads retain their own contracts.

| Owner | Responsibility |
| --- | --- |
| Controller | Authenticate, validate input, select trusted context and forward admission metadata. |
| Agent | Instructions, tools, context and starting execution. |
| Run handle | Identify and optionally manage one admitted execution; provide safe JSON. |
| Conversation service | Persist history, enforce ownership, order turns and stop the conversation. |
| Queue | Claim, execute and recover jobs under its existing retry policies. |
| Realtime service | Route authorized stream updates and run controls without owning execution. |

For a thread list, keep selection policy in the application:

`server/chat/listChatThreads.ts`:

```ts
import { AiConversation, type AgentReadContext } from '@db3.ai/app/ai';

/** Lists only this user's help threads, with bounded keyset pagination. */
export async function listChatThreads(actor: AgentReadContext, input: { before?: string }) {
	const query = AiConversation.where('user', actor.userId).where('scope', actor.scopeId!).where('agent', 'HelpAgent').orderBy('id', 'desc');
	if (input.before) query.where('id', '<', input.before);
	const rows = await query.limit(31).all();
	const page = rows.slice(0, 30);
	return {
		items: page.map(row => ({ id: String(row.id), title: row.title || 'Help conversation', updatedAt: row.updatedAt })),
		nextBefore: rows.length > 30 ? String(page.at(-1)!.id) : null,
	};
}
```

This example lists threads by creation ID. Updated-activity ordering would need
its own stable cursor. Do not substitute an unscoped model query for this list.

## 5. Keep routes in the application's normal controller system

Mount the send action through the application's existing router, exactly like
other controller actions. The thread-list action authenticates the request and
calls the scoped list function above. Snapshot, history and Stop actions delegate
to the existing conversation services with the authenticated actor. Any new thin
HTTP helpers for these actions should remain optional; applications do not need
to register their send behavior in a framework callback.

| Application route | Controller responsibility |
| --- | --- |
| `GET /api/chat?before=...` | Authenticate and call the scoped thread-list function. |
| `POST /api/chat/send` | Queue one intentional turn and return its handle as admission JSON with 202. |
| `GET /api/chat/:id/snapshot?view=conversation` | Authorize and load current run state and recent saved messages. |
| `GET /api/chat/:id/history?view=conversation&before=...` | Authorize, validate cursor and load older saved messages. |
| `POST /api/chat/:id/stop` | Authorize, save cancellation and signal the exact active execution. |

The application schema validates the message, optional conversation ID and
submission key. Read/list routes validate their cursors. The browser view is
fixed to `conversation`; query strings cannot enable admin diagnostics. Preserve
the application's session and cookie/CSRF policy.

### Complete snapshot, history and Stop actions

`server/chat/chatAccess.ts` uses existing service APIs. It keeps the repeated
read-route actor mapping in one application helper. Queue admission needs no
separate actor object because the agent already has trusted user/scope context.

```ts
import { z } from 'zod';
import { app } from '@db3.ai/app/server';
import type { RouteContext } from '../file-routes';
import { requireAuthenticatedUser } from '../api/_shared/auth';

/** Validates a requested thread identity without selecting an arbitrary scope. */
const Params = z.object({ id: z.string().trim().min(1).max(128) });

/** Resolves trusted identity for conversation read/control service policies. */
export async function chatAccess(context: RouteContext) {
	const user = await requireAuthenticatedUser(context);
	const { id } = Params.parse(context.request.params);
	return {
		service: app().ai.conversations,
		actor: { userId: user.id, scopeId: user.id },
		id,
	};
}
```

`server/api/chat/[id]/snapshot.get.ts`:

```ts
import type { RouteContext } from '../../../file-routes';
import { chatAccess } from '../../../chat/chatAccess';

/** Restores saved state without starting or requeueing any execution. */
export default async function snapshot(context: RouteContext) {
	const { service, actor, id } = await chatAccess(context);
	return service.load(actor, { conversationId: id, view: 'conversation' });
}
```

`server/api/chat/[id]/history.get.ts`:

```ts
import { z } from 'zod';
import type { RouteContext } from '../../../file-routes';
import { chatAccess } from '../../../chat/chatAccess';

/** Restricts the history cursor to a nonnegative safe sequence number. */
const HistoryQuery = z.object({
	before: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
});

/** Loads an older page from the same authorized conversation. */
export default async function history(context: RouteContext) {
	const { service, actor, id } = await chatAccess(context);
	const { before } = HistoryQuery.parse(context.request.query);
	return service.load(actor, { conversationId: id, view: 'conversation', before });
}
```

`server/api/chat/[id]/stop.post.ts`:

```ts
import type { RouteContext } from '../../../file-routes';
import { chatAccess } from '../../../chat/chatAccess';

/** Stops the active turn and pending followups, preserving saved history. */
export default async function stop(context: RouteContext) {
	const { service, actor, id } = await chatAccess(context);
	return service.stop(actor, { conversationId: id });
}
```

Each load/stop service call enforces its configured policy; knowing an ID never
grants access. Stopping does not require the original server-side handle. The
browser can stop a running conversation after returning on a different page load.
The optional thread-list endpoint can wrap `listChatThreads` above with the same
authenticated private-user scope and a validated creation-ID cursor.

Transport endpoints still need to be mounted once during API bootstrap:

- `/api/ws`: the existing shared user-authenticated socket, with authorized
  conversation channels alongside notification/job channels.
- `/_internal/ai/runs`: the proposed service-authenticated run socket, restricted
  to private networking and mounted on the existing server.

These mounts are infrastructure configuration, separate from defining a chat
controller. Framework AI owns relay routing and execution bindings. Generic
WebSocket code owns connections and channel mechanics. Browser authorization
comes from its authenticated session, never from submitted user IDs or worker
credentials. An existing application such as Scout contributes the conversation
channels to its current socket mount; it does not create a second browser socket.
Transport mount API names remain to be settled during implementation.

## 6. Connect the browser once

The application shell owns its existing `WebSocketClient`. At login it creates
and connects it using the current session; at logout or account/scope change it
disposes chat viewers and closes/recreates the socket. Feature components borrow
the connection and release only their own subscriptions.

```ts
import { WebSocketClient } from '@db3.ai/app/websocket/client';

const url = new URL('/api/ws', location.href);
url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const sharedSocket = new WebSocketClient({ url: url.href, token: sessionToken });
sharedSocket.connect();
```

`sessionToken` is an application-owned function returning the current authenticated
session token. HTTP reads the same session:

```ts
/** Uses the signed-in application's session for every chat HTTP request. */
function authHeaders(): Record<string, string> {
	const token = sessionToken();
	return token ? { authorization: `Bearer ${token}` } : {};
}
```

This example assumes a synchronous session token getter. Neither function returns
an AI-provider or relay secret. The authenticated app shell calls
`sharedSocket.close()` on logout or shell disposal, after releasing its chat and
notification subscriptions. Ordinary chat navigation releases only that viewer.


The proposed `createAgentChat` helper accepts that shared client. Internally it
combines `createAgentConversationHttp`, the existing send endpoint pattern and a
channel adapter. It needs additive listener APIs for connection, subscribed and
denied events on `WebSocketClient`; it must not overwrite another feature's
callbacks or take ownership of the physical connection.

## 7. Keep browser workflow in a composable

`client/chat/useChat.ts` — **uses proposed `createAgentChat`**:

```ts
import { onScopeDispose, ref, shallowRef } from 'vue';
import { createAgentChat } from '@db3.ai/app/ai/client';
import type { WebSocketClient } from '@db3.ai/app/websocket/client';

/** Owns one selected conversation viewer, without owning its server execution. */
export function useChat(socket: WebSocketClient, headers: () => Record<string, string>) {
	const chat = createAgentChat({ baseUrl: '/api/chat', socket, headers });
	const state = shallowRef(chat.getState());
	const draft = ref('');
	const error = ref('');
	const busy = ref(false);
	const unsubscribe = chat.onChange(value => { state.value = value; });

	/** Reports action failures while the client retains uncertain submissions. */
	async function perform<T>(operation: () => Promise<T>): Promise<T | undefined> {
		if (busy.value) return undefined;
		busy.value = true;
		error.value = '';
		try { return await operation(); }
		catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to update this conversation.'; }
		finally { busy.value = false; }
	}

	/** Restores a saved thread; never submits another model request. */
	async function open(id: string): Promise<void> { await perform(() => chat.open(id)); }

	/** Starts a new turn; the returned ID becomes the durable thread URL. */
	async function send(): Promise<string | undefined> {
		const message = draft.value.trim();
		if (!message || !state.value.canSend) return undefined;
		const admitted = await perform(() => chat.send(message));
		if (admitted) { draft.value = ''; return admitted.conversationId; }
	}

	/** Retries only an uncertain admission, preserving its submission key. */
	async function retrySend(): Promise<string | undefined> {
		const admitted = await perform(() => chat.retrySend());
		if (admitted) { draft.value = ''; return admitted.conversationId; }
	}

	/** Requests cancellation; socket disconnection alone never invokes this. */
	async function stop(): Promise<void> { await perform(() => chat.stop()); }

	/** Retrieves one older page using the framework's retained history cursor. */
	async function loadOlder(): Promise<void> { await perform(() => chat.loadOlder()); }

	/** Reconciles saved state explicitly when a viewer wants to refresh. */
	async function refresh(): Promise<void> { await perform(() => chat.refresh()); }

	onScopeDispose(() => { unsubscribe(); chat.close(); });
	return { state, draft, error, busy, open, send, retrySend, stop, loadOlder, refresh };
}
```

After a socket disconnect, `WebSocketClient` reconnects with bounded backoff and
resubscribes. The proposed adapter forwards the subscription acknowledgement to
the existing conversation client, which refreshes saved state. No reconnect hook
calls `send()` or `queue()`. On a full page reload, the URL supplies the thread ID
and the page calls `open(id)` to load history and attach again. If the run completed
while the browser was away, its saved answer appears without another AI call.

An admission call is short: `busy` does not remain true during model generation.
The framework's `sending` and `canRetrySend` distinguish admission uncertainty
from the agent's saved `run.status`.

## 8. Render the chat

`client/chat/ChatPage.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import type { WebSocketClient } from '@db3.ai/app/websocket/client';
import { useChat } from './useChat';

const props = defineProps<{ conversationId?: string; socket: WebSocketClient; headers: () => Record<string, string> }>();
const router = useRouter();
const { state, draft, error, busy, open, send, retrySend, stop, loadOlder, refresh } = useChat(props.socket, props.headers);
const messages = computed(() => state.value.snapshot?.timeline.filter(item => item.kind === 'message') ?? []);
const active = computed(() => ['queued', 'running', 'waiting'].includes(state.value.snapshot?.run?.status ?? ''));

/** Keeps the accepted thread address so reopening never submits the message again. */
async function submit(): Promise<void> {
	const id = await send();
	if (id) await router.replace(`/chat/${encodeURIComponent(id)}`);
}

/** Recovers a lost admission response with the same logical submission. */
async function retry(): Promise<void> {
	const id = await retrySend();
	if (id) await router.replace(`/chat/${encodeURIComponent(id)}`);
}

onMounted(() => { if (props.conversationId) void open(props.conversationId); });
</script>

<template>
	<section aria-label="Help conversation">
		<RouterLink to="/chat">New conversation</RouterLink>
		<p role="status">{{ state.snapshot?.activity?.label || 'Ready' }}</p>
		<p v-if="state.connection === 'connecting' || state.connection === 'disconnected'">Reconnecting to live updates…</p>
		<p v-if="state.snapshot?.run?.status === 'cancelled'">Stopped. Send a message to start another turn.</p>
		<p v-if="error || state.error" role="alert">{{ error || state.error }}</p>
		<button v-if="state.snapshot?.older !== null && state.snapshot?.older !== undefined" :disabled="busy" @click="loadOlder">Load older messages</button>
		<ol aria-label="Messages">
			<li v-for="message in messages" :key="message.id">
				<strong>{{ message.role === 'user' ? 'You' : 'Assistant' }}</strong>
				<p class="whitespace-pre-wrap">{{ message.content }}</p>
			</li>
		</ol>
		<form @submit.prevent="submit">
			<label for="chat-message">Message</label>
			<textarea id="chat-message" v-model="draft" :disabled="busy" />
			<button type="submit" :disabled="busy || !state.canSend || !draft.trim()">Send</button>
			<button v-if="active" type="button" :disabled="busy" @click="stop">Stop</button>
			<button v-if="state.canRetrySend" type="button" :disabled="busy" @click="retry">Retry send</button>
			<button type="button" :disabled="busy || !state.snapshot" @click="refresh">Refresh</button>
		</form>
	</section>
</template>
```

The app's router supplies the decoded conversation ID, shared socket and headers
function. Key the page by conversation ID (or `new`) so navigation disposes the old
viewer and creates a fresh one. New conversation clears selection; it does not
delete or cancel another thread. Preserve the draft while an admission is
uncertain. The client keeps its retry key in memory; surviving a full reload
before admission is acknowledged would require additional session-scoped pending
submission storage and is not promised by this first slice.

The minimal renderer deliberately shows message text only. Production components
can additionally render tool cards and provider-exposed reasoning summaries from
the same timeline. Only explicitly projected tools appear in customer views;
raw prompts and admin diagnostics never belong in this page. Use safe Markdown
rendering if desired; do not insert model HTML directly.

For a thread sidebar, call authenticated `GET /api/chat`, render its `items` as
links to `/chat/:id`, and use `nextBefore` for older threads. Store only the ID in
the URL; the server remains authoritative for messages and access. Thread listing
is independent of attaching to or starting a run.

## What the user can expect

| User action | Result |
| --- | --- |
| Send in a new chat | Creates a conversation, admits a background turn and attaches the viewer. |
| Send during an active turn | Admits a FIFO followup in the same conversation; does not interrupt its current turn. |
| Close the tab or navigate away | Removes the viewer; the execution owner keeps running and saving messages. |
| Reopen the thread URL | Loads saved history, subscribes and refreshes again after subscription to close the attachment race. |
| Reconnect during generation | Receives future deltas; a later saved message replaces its partial output by identity. |
| Return after completion | Displays the final saved answer immediately. No agent restart is required. |
| Stop | Cancels the active turn and queued followups; retains previously saved history and completed saved tool results. |
| Send after Stop | Admits a new turn with a new submission key, using the same saved conversation history. |
| Retry send | Reuses the key of an uncertain admission, preventing a second logical turn. |

“Start again” means a new turn, not resuming the exact interrupted provider call.
There is no separate Start API or automatic replay of the cancelled user message.
A future explicit Regenerate action is separate product work.

Stop is a durable cancellation decision plus a cooperative signal, not proof that
every external tool has already terminated. Previously started parallel tools may
still finish external work. Late output cannot take ownership back from a
cancelled or newer run. The current policy rejects saves after cancellation;
retaining the current unfinished answer would be a separate behavior change.

Live output is best effort. No per-token SQL writes or durable delta replay are
introduced. A user returning halfway through an unfinished answer may see a gap
until that answer is saved; the final saved item restores its complete text.
“Reconnect” must not be documented as guaranteed replay of every missed token.

## For queued mode, run the background process once per application

Queued deployment starts the app's normal database queue worker with the same bootstrap
and registered agent classes as the API. It is not one process per chat and it is
not launched by a controller. A programmatic host uses the existing lifecycle:

```ts
const worker = application.queue.startWorker({ queues: ['default'], concurrency: 4 });
// The process supervisor owns termination. On graceful shutdown:
await worker.stopAndDrain();
await application.close();
```

The shutdown lines run on termination, not immediately after startup. Configure
the existing queue CLI in a real app rather than copying a second job runner into
each feature. Four slots allow four independently claimed jobs in this process;
each active agent owns its optional relay socket only for its execution attempt.

## Framework implementation contract behind this experience

Prioritize the private relay and Stop signalling over optional run-handle work.
Implement them as separate increments over current queue admission. The handle is not a prerequisite for subscribing to a running
conversation; identifiers already support that. Keep the existing low-level
run/stream completion semantics and avoid introducing another background runner.

1. The AI runtime creates and disposes the run transport. No job author calls a
   connect function, writes a Stop handler or manages a socket map.
2. The app-owned relay binds a connection to conversation, root request and writer
   attempt after service authentication. Binding/rebinding verifies durable
   cancellation and current ownership before accepting live publications.
3. The API associates a run with its private connection. Browser channels retain
   their existing session/resource policies and customer/admin projections.
4. Stop commits first, then signals the bound execution; local executions use the
   same abort path directly. Old/duplicate commands cannot stop a new attempt.
5. Disconnect never implies Stop. Reconnect restores bindings and rechecks saved
   state. Delivery/acknowledgement failure must trigger recovery rather than
   silently pretending a stop reached its worker.
6. No SQL cancellation query is added per token or tool step. The socket-enabled
   path removes its periodic recorder check only after the race/failure gate passes. Local steps inspect
   an AbortSignal. Existing persistence/ownership checks remain. Removing the
   conversation timer requires tests for ordinary AgentRunJob as well as retained
   RunnableJob hosts: the former does not inherit the latter's SQL heartbeat.
7. Silent disconnected executions cannot receive immediate cancellation. They
   discover it on reattachment or an existing persistence/ownership checkpoint;
   operation timeouts still bound stalled work. This limitation is explicit.
8. Buffers, authentication deadlines, ping/pong, reconnect backoff and shutdown are
   bounded. Slow viewers do not stall model execution. Close releases sockets,
   timers, listeners, connection maps and pending acknowledgements.
9. One active API relay is supported initially. API replacement closes old run
   sockets so they reconnect through the stable private gateway; register the
   Upgrade path at both gateway/proxy hops. Keep it unreachable through the public
   listener. Workers do not expose listening ports.
10. Existing notifications retain their SQL inbox and committed invalidations;
    their browser subscriptions share the same socket. Non-AI worker publications
    can keep the current HTTP bridge. This AI-specific change must not require
    every worker to open a persistent connection.

## Acceptance before publishing this as a supported guide

- Compile the example as an independent packed-package consumer, including new
  exports, server types and the browser build with no server-only dependencies.
- Exercise actual HTTP admission, SQL queue execution and both socket hops with
  a controlled external provider; cover no-viewer execution and terminal output.
- Verify handle JSON matches the existing admission contract and exposes no agent
  context; constructing/returning/serializing it never re-executes the job.
- Verify run-specific cancellation cannot affect a newer turn, handles queued and
  active runs correctly, and terminal cancellation is harmless.
- Verify new/missing/invalid conversation IDs, concurrent duplicate submissions,
  changed-payload key conflicts and intentional repeated identical messages.
- Verify opening/reopening/reconnecting only loads/subscribes, with no admission
  request and no new queue job or worker process.
- Close/reopen a browser, switch threads, open two viewers, reload saved history,
  and prove that none of these starts or cancels work.
- Test duplicate/uncertain admission, FIFO followups, Stop followed by a new turn,
  stale Stop, wrong-run bindings, delayed old frames and four concurrent runs.
- Test API restart, worker reconnection, Stop while disconnected, cancellation
  racing attachment, failed acknowledgement and queue retry/reconstruction.
- Verify foreign users, revoked sessions, cross-scope requests and normal users
  requesting admin views cannot access history, live frames or controls.
- Verify notification inbox, toast/banner behavior and cross-tab dismissal still
  work on the shared socket; rollbacks must not broadcast committed changes.
- Assert no added per-event cancellation queries and bounded resources under
  slow/offline peers. Clean up every test socket, process and disposable database.
- Review the running UI at desktop and narrow widths, keyboard interactions,
  empty/loading/denied/disconnected/failed/stopped states and safe rendering.
- Replace proposed API labels only after the examples run; move the implemented
  guide into service-owned documentation and remove obsolete proposal material.

## Decisions to settle during implementation

- Final run-handle type, status/cancel results and lookup API. Run cancellation
  must remain distinct from conversation-wide Stop.
- Whether to add a validated submission input overload later; the initial guide
  explicitly forwards the key and does not hide HTTP state inside Agent.
- Transport composition with an already-mounted browser endpoint; the application
  should mount its shared browser socket exactly once.
- Whether the first browser convenience helper is `createAgentChat` or an overload
  of the current factory. Keep one conversation state machine either way.
- Stop acknowledgement is internal initially; a separate user-visible
  “execution has physically stopped” state would require an explicit contract.
- The initial example uses private, user-owned threads. Organization/shared
  threads require explicit product permissions for sending and stopping as well
  as viewing; do not infer mutation rights from subscription access.

## Source anchors for this draft

- [Agent and background conversations](../packages/app/src/ai/README.md)
- [Current conversation client](../packages/app/src/ai/client/AgentConversationClient.ts)
- [Existing help client adapter](../packages/app/src/ai/examples/createHelpConversationClient.ts)
- [Current conversation contracts](../packages/app/src/ai/contracts/AgentConversationStream.ts)
- [WebSocket service and shared channels](../packages/app/src/websocket/README.md)
- [Queue execution and shutdown](../packages/app/src/queue/README.md)
- [Durable in-app notifications](../packages/app/src/in-app/README.md)
