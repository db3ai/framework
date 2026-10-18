# AI

Build AI features inside your db3 application with `app().ai` and `Agent`.
The service owns provider execution, rate limits and request tracking. Your app
owns prompts, tools, authorization, storage destinations and commercial policy.

## Start in your app

The generated app configures `new App({ ai: config.ai })` and includes
`AiConversation`, `AiMessage`, `AiRequest`, `AiRateLimitBucket` and
`AiRateLimitReservation` in its migration registry. Set `OPENAI_API_KEY` and
`OPENAI_MODEL` in the server `.env`, apply migrations and restart. Existing apps
must register these models and generate a committed migration before using AI.

```ts
import { app } from '@db3.ai/app/server';

const result = await app().ai.generateTextWithResponse({
	instructions: 'Summarise this note in three short points.',
	input: note.body,
	maxOutputTokens: 400,
}, { user: userId, scope: teamId });
```

`generateText()` returns a string. `generateTextWithResponse()` also returns the
saved request and conversation IDs. Direct generation tracks a conversation but
does not replay its previous messages; use an agent for conversational memory.

## Context measurements and provider compaction

Agents can return the Responses SDK's `contextManagement` settings from
`modelSettings()` to enable provider-managed compaction. These settings are sent
only to direct OpenAI attempts. `contextWindowTokens(model)` defaults to `null`;
an application may override it with a verified model capacity. No capacity is
inferred from the model name or from cumulative billed usage.

With durable streaming enabled, snapshots and `context.changed` events expose
`context`: model, capacity, last measured input tokens, compaction status and
count. Input usage is per completed model call. It becomes unknown during and
immediately after compaction, since that response's usage describes its original
input. The next model response supplies a fresh measurement.

A successful run checkpoints input from its latest native compaction item along
with provider finalization under the existing writer fence. The encrypted item
is passed unchanged on continuation; it is not a human-readable summary. The
watermark excludes queued followups, which remain eligible for subsequent turns.
The full `AiMessage` transcript remains available. Checkpoints are private and
are not part of any snapshot or live event, including admin views. A changed
model replays ordinary saved history instead of reusing an incompatible checkpoint.
Credit-settlement retries reuse finalized output without calling the model again.

Compaction does not make arbitrarily oversized tool results safe: applications
must bound those results before the next request. Context-limit errors retain a
safe provider code in ordinary run projections so applications can offer recovery
without exposing provider diagnostics or automatically replaying mutations.

## Agents and function calls

Create a class under your app's `server/agents/` directory extending `Agent`.
Implement `instructions()` and `tools()`. Use the exported `tool` helper with a
Zod parameter schema to expose an application function. Install `zod` as an app
dependency when importing it in your tools.

See [HelpAgent.ts](./examples/HelpAgent.ts) for a tested function-calling agent.
Its context selects a trusted storage path, user and scope. `run(message)`
returns final output and saved IDs; `stream(message, emit)` emits typed events
and returns null after a `run.error` event. A conversation can be resumed by
supplying its ID with matching user, scope and agent identity.

Agents default to a maximum of eight model turns per run. Override the protected
`maxTurns` property with a number to change that limit, or with `null` to allow
the agent to finish without a turn ceiling. For example,
`protected override readonly maxTurns = null;` applies to live runs, queued runs
and resumed conversations. A model turn can request tools or produce the final
answer; the agent stops naturally when it returns its final answer.

Register `AgentRunJob` on the queue and call `registerQueuedAgent(name, Class)`
at boot in both web and worker processes before using `agent.queue(message)`.
Its constructor context must be serializable. Queued agents require the normal
queue models and a worker listening on the selected queue.

## Background conversations

Enable `ai.streaming.enabled` with the existing conversation, message and request
models. Subclasses replacing model fields include `AiConversation.streamFields(field)`
and `AiRequest.admissionFields(field)`. Apply an application migration for these
fields. There is no stream-event table, delta journal, replay cursor or publisher
maintenance job. Apps upgrading from the earlier journal implementation should
drop `ai_stream_events`, `stream_sequence` and `stream_published_sequence` after
stopping old API/worker processes; retain `stream_state` and admission fields.

Register `AgentRunJob` and your agents in API and worker processes. Configure the
existing [WebSockets worker bridge](../websocket/README.md) for separate processes.
An authenticated send route validates input, derives ownership and returns HTTP
202 from the same API a scheduled job uses:

```ts
const run = await new HelpAgent({
	user: authenticatedUserId,
	scope: authorizedTeamId,
	guidePath: 'help/guide.md',
	conversationId: body.conversationId ?? undefined,
}).queue(body.message, { idempotencyKey: body.idempotencyKey });
// { conversationId, aiRequestId, jobId, traceId }
```

Admission saves the request, user message and conversation state before awaiting
the ordinary queue dispatch API. Dispatch returns an opaque job ID after driver
acceptance; AI does not inspect the queue driver. SQL and Redis are supported.
A rejected dispatch retains the request as failed and clears its queued stream
state. Saving records and publishing the job are not an atomic operation: a crash
between them can leave an unqueued request. Commit any caller-owned SQL transaction
before queuing through an external broker. A followup
on an active conversation joins its FIFO queue; it does not interrupt the active
provider call. Each turn loads fresh saved history when execution begins. Future
queued messages are excluded from the current turn's provider input. The existing
queue defers followers without spending attempts. Apps can refresh domain context
in `beforeQueuedRun(root, conversation)`, after ownership is claimed but before
instructions and credit allowance are evaluated. The hook must recognize same-root
retries. It also restores product policy for settlement-only retries; skip domain
activation when `root.response.providerFinalized` is true. Pin state-dependent
product decisions on the root so a retry cannot change the original charge.

The browser client creates one submission UUID per intentional send and keeps it
for `retrySend()` after an uncertain HTTP response. A key is scoped to actor, scope
and agent; changed input with the same key returns 409. Scheduled jobs can omit it.
A concurrent duplicate briefly waits for the original queue acknowledgement; if
it remains unconfirmed, it returns 409 and can be retried with the same key. A
failed submission with no receipt returns 409; an intentional new send needs a new
key. Existing receipts are reused even after execution completes. An outbox and
automatic recovery of requests interrupted before dispatch are not provided.

Workers emit live events without knowing whether anyone is watching. Text deltas
coalesce in memory (100 ms by default) and never write SQL. Existing message/tool
save boundaries publish complete canonical items. Final assistant output uses the
same identity as its live partial. Transport failures do not fail or retry provider
work. Bounded in-memory delivery can drop updates; there is no delivery guarantee.

The conversation record owns current run state and writer fencing. Existing queue
claims and retries handle worker failure. Provider completion is durable before
billing settlement, so settlement retries do not call the provider again. Individual
tool completions are saved as they finish, including parallel tools. Tools still own
their idempotency/checkpoints for external effects. Applications with custom queue
adapters delegate retry/failure hooks to `AgentRunJob`; released attempts show
`waiting`, and terminal failure clears the active state through a fresh writer.

Configure `ai.streaming.onRunStateChanged(conversation)` to invalidate an
application-owned activity channel after committed admission, run status or
queued-input changes. It covers direct and queued agents, including queue retry,
Stop and terminal recovery; message saves, text deltas and tool progress alone do
not invoke it. The callback reloads current state after the outer transaction
commits, is suppressed on rollback and cannot fail agent execution. Choose and
authorize recipients in the application. Publish a content-free invalidation and
reload the authorized aggregate on initial subscription, reconnect and focus;
no browser activity polling is required. Delivery is best effort, not an outbox.

### Reading and attaching

Set `ai.streaming.authorize` and `authorizeStop` to application resource policies.
Missing policy denies access. Reads require trusted `{ userId, scopeId? }`. Register
an app socket channel `ai:conversation:{id}:conversation` whose subscription and
every-delivery authorization call `conversations.authorized(actor, id, view)`.
Resolve current membership in socket policy; a known ID never grants access.

Map ordinary authenticated JSON routes to the service:

| Route | Service |
| --- | --- |
| `GET /conversations/:id/snapshot?view=conversation` | `load(actor, { conversationId, view })` |
| `GET /conversations/:id/history?view=conversation&before=…` | `load(actor, { conversationId, view, before })` |
| `POST /conversations/:id/stop` | `stop(actor, { conversationId })` |

Snapshots contain `timeline`, `run`, `activity`, `queued` and `older`, plus
conversation/view identity. Recent history defaults to 40 message rows (maximum
100); `older` follows database message order. HTTP returns full display-ready
items, including tool results. Oversized socket items cause an ordinary history
refresh. There are no mandatory “open details” placeholders.

Import browser APIs from `@db3.ai/app/ai/client`:

```ts
const http = createAgentConversationHttp({ baseUrl: '/api/conversations', view: 'conversation' });
const conversation = createAgentConversation({ view: 'conversation', http: { ...http, send }, realtime });
const detach = conversation.onChange(state => render(state));
await conversation.open(conversationId);
await conversation.send('Continue with the next section'); // Queues when already running.
// On view disposal: detach(); conversation.dispose();
```

See the [complete adapter example](./examples/createHelpConversationClient.ts).
The app supplies its contextual send route and shared socket owner, then renders
the returned state. `stream(id, callback)` offers observational snapshot/event/
connection/error notices. The HTTP helper accepts injected fetch and headers.

The realtime adapter subscribes to event `updates` on
`ai:conversation:<id>:<view>`. Forward every subscription/reconnection acknowledgement
to `subscribed()`, frames to `update(value)`, transport health to `connection(state)`
and access loss to `denied()`. Cleanup removes only this subscription.

The client loads saved history, subscribes, then refreshes history again to cover
messages saved during connection. Reconnect repeats that refresh. Canonical items
replace live partials by identity; partial prefixes can be missing until save.
There is no delta replay or polling timer. `refresh()` also works when the socket
is offline. `loadOlder()` pages saved history; loaded pages are reconciled on refresh.
Disposal aborts viewer reads and listeners; it never stops worker execution.

### Conversation attention and read state

Completed, failed and blocked runs save the latest attention occurrence in
`stream_state` atomically with the terminal state. Cancelled runs do not create
attention. No table migration is required for applications already using this
field, and historical runs are not retroactively marked unread. New admissions
preserve the previous occurrence until another result needs attention.

Snapshots include `attention: { id, kind, unread } | null`, projected for the
authenticated reader. After rendering a visible conversation, acknowledge that
exact occurrence with `conversations.markRead(actor, { conversationId,
attentionId })`. This rechecks conversation authorization and serializes receipts
under the conversation lock. A stale acknowledgement cannot clear a newer result;
another reader retains their own unread state. Reading lists or snapshots alone
does not mark anything read. Receipts live only on the latest occurrence, rather
than retaining a history of every reader's activity.

Trusted server workflows can call `conversations.requestAttention(conversationId,
{ id: occurrenceKey, kind: 'approval' | 'input' })`. Repeating the current key
preserves receipts. Hosts must not replay superseded occurrences or expose this
producer API directly to browsers. Read state is distinct from approval/input
resolution: acknowledging a view never grants permission or resumes execution.
`attentionFor(actor, conversation)` projects already-authorized records for
application-owned list endpoints; it is not itself an authorization boundary.

Configure `ai.streaming.onAttentionChanged(conversation)` to invalidate the
application's recipient channel after committed attention and read changes.
Rollback suppresses invalidation; delivery failure cannot undo saved state.
Register recipient-only channel authorization and reload authorized HTTP state on
initial load, reconnect and focus. Signals are best effort, without an outbox or
guaranteed delivery while disconnected. Keep this listener at application scope
so navigating away from the conversation does not lose completion indicators.

`admin` exposes diagnostic prompts, tools and provider reasoning summaries.
`conversation` hides prompts, includes provider summaries, and exposes tools only
through an explicit `projectTool` policy. `status` contains only activity and
lifecycle. Provider summaries are optional model output, not private chain of
thought. `Thinking…` remains useful when no summary is emitted. Running state is
independent of socket connection and is available immediately on reopening.

For legacy rejected direct-stream admissions, `repairRejectedRequests(conversationId)`
is an explicit migration operation. It fails only pending roots without user input,
provider work, queue identity or run ownership, preserving their audit records and
the actual active run. Drain old processes before repair. App migrations must also
exclude any request referenced by domain work. The runtime prevents new direct
admission failures from leaving those rows by rolling back preparation atomically.

## Browser computer tools

`computerTool` and the `Computer` type are exported from `@db3.ai/app/ai`.
Implement the SDK `Computer` contract in an application-owned browser adapter:
return PNG base64 from `screenshot()`, expose the matching viewport dimensions,
and delegate mouse, keyboard, scroll and drag actions to that isolated browser.
Add `computerTool({ name: 'computer', computer: adapter })` to the agent's tools
with its normal title/description metadata. The existing Agents SDK runs the
native computer-call/screenshot loop; do not create a second provider loop.
A compatible model such as `gpt-6-luna` can combine this tool with ordinary
function tools in the same run.

The application owns allocation, navigation restrictions, deadlines, recordings,
cleanup and evidence semantics. Provider-requested safety checks need explicit
handling: returning `false` only omits acknowledgement and does not stop the SDK
from executing input. Throw from `onSafetyCheck` when unattended execution must
stop for review. Native tool-action errors may return an empty screenshot through
the SDK; never treat the final model message alone as evidence of success.
Screenshot inputs and tool outputs can be retained in local AI request records;
apply the same access and retention rules as other private prompts. Resuming an
AI conversation does not restore its browser session. See
[OpenAI's computer-use guide](https://developers.openai.com/api/docs/guides/tools-computer-use)
for the provider contract.

## Images, embeddings and structured output

- `generateImage(input, { store })` returns image bytes and an optional app-owned
  storage reference. See [createHelpImage.ts](./examples/createHelpImage.ts).
- `generateEmbedding(text, model?, options?)` returns a vector, model and request
  ID. The app owns indexing, source revisions and authorized retrieval.
- `chunkEmbeddingText(text, { context })` prepares extracted text for the
  `text-embedding-3-small`/`large` models using their `cl100k_base` tokenizer.
  Documents that fit stay whole. Oversized documents split at headings,
  paragraphs, sentences or whitespace, retaining bounded source context,
  heading ancestry and up to 128 tokens of preceding overlap. Every complete
  input stays within 8,000 tokens by default, including those prefixes.
  Source offsets and exact text slices remain available for retrieval.
  This helper makes no provider calls and does not extract HTML or generate
  summaries. Context metadata is capped to leave room for source text.
- `generateStructured({ instructions, input, schemaName, schema })` returns
  locally validated `data`, text and tracking IDs. Schemas use Zod.

Agent instances expose these same methods. Calls made inside an executing tool
inherit the current conversation and parent request, including calls through
`app().ai`. Nested calls cannot carry a second independent usage charge.

See [prepareDocumentEmbeddings.ts](./examples/prepareDocumentEmbeddings.ts) for
preparing and embedding passages. Applications own atomic publication, retries,
source revision checks and permission-scoped retrieval. Keep the original
source and its identity so a matching passage can be read in its wider context.

## Conversations and request records

`AiConversation`, `AiMessage` and `AiRequest` are shipped ActiveRecord classes.
Extend them in your app and configure `ai.models` with the replacement
constructors. Replace the corresponding entries in your migration registry and
generate a migration. See [Conversation.ts](./examples/Conversation.ts).
Keep table names unless you also override the related model link fields.

`user` and `scope` store optional application identifiers. An app may replace
these fields with typed model links. `scopeField` adapts an existing logical
ownership field; calls using that adapter supply that field in logging options.

Use `agentConversationTimeline(messages, toolDefinitions, requests)` to rebuild
stream-compatible history after authorizing access. The formatter includes
diagnostic prompt items; filter those from ordinary user views. It supplies
data for your renderer, not a history endpoint or UI component.

Every provider attempt retains status, input, response, usage and timing.
`AiRequest.runCostSummary(id)` aggregates recursively linked provider work
without counting the root aggregate twice. Unknown usage and costs remain
unknown. When `unpricedRequestCount` is nonzero, `totalCostUSD` is only the known
subtotal. Price estimates are not invoices or a customer credit ledger.

Request persistence is enabled by default. Prompts, responses and tool results
may contain private information. Apply your app's access and retention policy.
`saveAiResponse: false` opts direct service calls out of record persistence.
OpenAI text requests set `store: false`; that does not disable local tracking or
all provider retention. Never expose provider credentials in client code.
If a pending embedding request cannot be saved, `generateEmbedding()` throws
`AIRequestTrackingError` before contacting the provider. Its `stage` identifies
the pending write and its `code` includes only recognized database lock codes;
the error deliberately omits the SQL exception because bindings may contain the
input text. This is separate from a provider rejection or a terminal usage-save
failure after provider execution.

## Models and cost estimates

Select `gpt-6-astra`, `gpt-6-sol` or `gpt-6-luna` through a per-call `model`
override or a named agent model in your app's AI config. Astra is intended for
the hardest tasks, Sol for demanding agent workflows, and Luna for focused,
high-volume work. OpenAI agents already use the Responses API required for
reasoning with tools. Preserve the workload's existing reasoning effort when
migrating. All three support `low` through `xhigh` in the framework; Sol and
Luna also support `none`. Do not use `minimal`, or custom `temperature`, `top_p`
or log probabilities with reasoning enabled. Availability depends on the API
project. Validate output quality and latency on representative application
tasks before a production rollout.

The shared `AI_MODEL_PRICING` table was checked against
[OpenAI's API prices](https://developers.openai.com/api/docs/pricing) on
2026-09-25. Standard USD prices per million tokens are:

| Model | Input | Cache read | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| `gpt-6-astra` | $10.00 | $1.00 | $12.50 | $50.00 |
| `gpt-6-sol` | $2.00 | $0.20 | $2.50 | $10.00 |
| `gpt-6-luna` | $0.10 | $0.01 | $0.125 | $0.50 |
| `gpt-5.6-sol` | $4.00 | $0.40 | $5.00 | $20.00 |
| `gpt-5.6-terra` | $2.00 | $0.20 | $2.50 | $12.00 |
| `gpt-5.6-luna` | $0.20 | $0.02 | $0.25 | $1.20 |

For these models, a request above 272,000 input tokens costs 2x all input
rates and 1.5x output rates for the full request. Agent runs calculate this
per provider request, so several short turns do not trigger the higher rates
merely because their combined usage exceeds the threshold. GPT-5.6 Sol's published
promotional rates are available at least through 2026-11-21; recheck the rate
card when that period ends rather than assuming a future price.

Direct OpenAI text and agent requests default to Standard processing. Pass
`serviceTier: 'flex'` to `generateText`, `generateTextWithResponse` or
`generateStructured`, or override `protected readonly serviceTier: AIServiceTier = 'flex'`
on an `Agent` subclass (import the type from `@db3.ai/app/ai`). The property
defaults to `'default'`; queued runs preserve the selected tier. Streaming and
tool turns use the same tier. Separate calls inside tools do not inherit it.
Nondefault tiers require an entirely OpenAI provider chain.

For the six models above, Flex token rates are half Standard and Fast/Priority
rates are twice Standard. Costs use each response's reported tier and model;
unconfirmed nonstandard tiers or missing tier rate cards remain unpriced.
Hosted-tool fees are unchanged. Estimates exclude regional surcharges. OpenRouter and xAI
use their provider-reported billed costs. Updates affect new estimates and
new request records; they do not rewrite stored costs or change app model defaults.

The default `gpt-4.1-mini` model and its dated snapshots also have a rate card:
$0.40 input, $0.10 cached input and $1.60 output per million tokens, verified
against [the model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
on 2026-10-01. This estimate supports small browser agents such as Cloud's
AI Test Engineer; interrupted requests with missing usage remain unpriced.

Image pricing includes `gpt-image-2.5-flare` and `gpt-image-2`: $5 text input,
$1.25 cached text input, $8 image input, $2 cached image input and $30 image
output per million tokens. Dated Flare snapshots resolve to the same rate card.
The models can consume different token counts at the same size and quality;
image costs use actual reported usage, not fixed per-image estimates. Apps
select Flare through `ImageGeneration` or a per-call `model` override.

## Providers and failover

Configure `ai.provider` with one provider, an ordered list or an ordered record
of provider/model pairs. Registered providers are OpenAI, OpenRouter, Groq, xAI
and DeepSeek. Provider keys, base URLs and model defaults use their corresponding
server environment variables. Calls and agent subclasses can select a chain.

Text and structured output require the Responses API. Agents also support the
registered Chat Completions providers. Images and embeddings currently use the
OpenAI adapter and do not fail over. Other protocols need a driver implementation.

Transient network, rate-limit, quota and server failures can advance to another
provider. Authentication and request validation failures do not. Agent failover
stops once the SDK emits an event, avoiding automatic replay of tool effects.
The per-request timeout defaults to 60 seconds for Standard and 15 minutes for
Flex; an explicit `ai.timeoutMs` overrides either. Recovery-probe leases cover
the selected timeout. SDK automatic retries remain off; existing bounded retry,
deferral and provider-stop rules still apply. This option does not add durable
checkpoints or guarantee multi-hour recovery. A partial stream or exhausted
retry window can still fail; test locally before enabling workflows.

The SQL-backed `AIRateLimiter` coordinates provider capacity across workers.
Agents reserve capacity for each SDK HTTP request and record response headers
before consuming the stream. Reservations are released before tools execute,
so a tool can call the same model without waiting on its own parent agent.
Transport failures also release reservations; later model turns reserve again.

Bucket observation and reservation release are best-effort bookkeeping after
provider work when they run as autocommit writes. Recognized SQL deadlocks and
lock timeouts retry the same write up to three times, with 25 ms and 50 ms
pauses; this never repeats the provider call or changes its saved outcome,
usage or cost. Three attempts limit the number of writes, not total elapsed
time: each attempt still uses the database session's lock-wait timeout.
Release uses a conditional database update and only then marks the lease
released in memory. Reusing a lease can therefore retry a failed release, while
an already released or deleted row remains an idempotent success.

A caller-owned transaction gets one attempt. Any bookkeeping or cleanup error
propagates unchanged to that transaction's owner, and the limiter performs no
further writes in the failed transaction. InnoDB can roll back the entire
transaction on a deadlock, including earlier request/usage writes; swallowing
that error would falsely imply a successful commit. Keep paid provider calls
outside retryable database transactions. The limiter does not retry the whole
transaction or replay a provider request.

If an autocommit observation or release still fails, the original provider
result or error continues. The previous database capacity remains in force,
and an unreleased reservation stops counting at its existing ten-minute expiry.
Global cleanup remains best effort outside caller-owned transactions and may
be retried by application maintenance policy. Structured warnings identify
`bucket:observe`, `reservation:release` or `reservation:cleanup`, with allowlisted
SQL lock codes, attempt count, recovery state, whether the caller transaction
failed, coordination/request IDs and expiry. They omit SQL, bindings, exception
messages, prompts and responses. Monitor these warnings to investigate recurring
contention; preserving the provider outcome does not establish its lock holder.

Flare image buckets use a conservative local fallback of five requests per
minute when response headers omit capacity; this is an admission policy, not
an assertion about the account's provider tier. Observed headers remain authoritative.
An image attempt deferred before provider execution is finalized in the audit
trail rather than left pending. Queue owners retain durable waiting state separately.
Ordinary direct text, image and embedding HTTP rejections throw `AIRequestError`
with `code`, `status` and `requestId` when supplied; missing fields remain `null`.
These identifiers exclude the provider payload and inputs. Known quota codes
(`insufficient_quota`, `billing_hard_limit_reached`) and explicit “no credits
remaining” responses throw `AIProviderStoppedError`, including code-less HTTP
429 responses. They stop only the affected request. Ordinary throttling still
raises `AIRateLimitDeferredError`. Configured failover can try another provider
before an agent emits output; it does not create a shared account block.
Capacity deferrals integrate with queue retries. The `allowance` hook
checks application budgets separately. Override `usageCharge()` and
`settleUsage()` in an agent when your app needs an idempotent commercial ledger.

## Stopping one conversation

Configure `ai.streaming.authorizeStop` independently of read permission. The
HTTP route supplies trusted user/scope identity and calls:

```ts
await app().ai.conversations.stop(actor, { conversationId });
```

Stop resolves the current turn under the conversation lock and cancels queued
inputs too, so waiting input cannot restart work immediately. Repeated stop is
safe. Saved messages/results remain; the root uses `failed` with
`errorCode: agent_cancelled`. Unsaved text deltas are transient. A new intentional
send can start another turn. Stop does not undo completed external effects.

Local execution is notified after commit. Remote workers check the writer fence
at saved-output boundaries and every five seconds during silent provider/tool waits.
This interval controls cancellation responsiveness, not the maximum run duration;
provider and tool deadlines remain independent. A saved-output checkpoint checks
before writing even when the next poll is not due.
Only active workers check; idle conversations do not poll. Provider calls use the
abort signal, and tools cooperate with cancellation. Queue claims fence stale
writers. Custom retained-job adapters can report cancelled/blocked outcomes with
`conversations.settleQueuedStop(rootId, message, status)`.

Browser handles call `conversation.stop()` using the conversation ID alone, then
refresh saved state. Navigation/disposal merely detaches the viewer.

## Provider failures and bounded retries

Provider failures are local to the request or agent run. There is no persistent
account outage guard, fifteen-minute failure deadline, or operator reset. Old
account-admission rows are ignored; removing this policy requires no migration.
Capacity rate limits, application allowances and usage accounting still apply.

`AIProviderTransport` retains safe HTTP/SSE diagnostics for the resolved request.
Quota errors terminate that run with `AIProviderStoppedError` (`stopStage: quota`).
Transient transport/408/5xx errors use `AIProviderRetryError`; ordinary queue
retries consume the configured job attempt budget. They do not defer forever or
block later requests using the same credential. Independent requests may still
fail if the provider itself remains unavailable or out of credit.

After completed model/tool turns, the SDK can retry only the current model
request, at most eight times, with bounded exponential delays from 1 to 30
seconds (or a bounded provider retry hint). It retains completed tools and exact
input. Each request reacquires normal capacity. Cancellation, quota, stateful
requests, and output from the current request veto recovery. A transient failure
after streamed output terminates that run (`stopStage: stream-output`) to avoid
replaying tools. Saved history and usage remain. These are bounded in-process
retries, not a promise of exactly-once external side effects after a worker crash.

`generateEmbedding(..., { retainResult: true })` opts into retaining the completed
vector in the existing request response. Applications may use this for partial
workflow resume after authorizing scope and matching the exact full input/model.
Default audits still keep dimensions only. Retention/access remain app policy.
No new tables or migrations are required by this change.

## Verification

### Maintenance map

- `Ai.ts`: direct provider requests, allowance hooks and tracking lifecycle.
- `Agent.ts`: conversational runs, tool events, provider attempts, queue setup
  and application extension hooks.
- `contracts/`: shared service, agent, event, provider and limiter contracts.
- `AgentHistory.ts`: transport-independent timeline reconstruction.
- `toolHelpers.ts`: typed context access, progress, errors and model attachments.
- `AgentRunJob.ts` and `registry.ts`: validation and durable reconstruction;
  applications register their own classes and model identities.
- `AiConversation.ts`, `AiMessage.ts`, `AiRequest.ts`: extensible record models.
- `AIRateLimiter.ts`, `AIProviders.ts`, `AIFailover.ts` and `OpenAIQuotaRetry.ts`:
  provider capacity, selection and retry behavior.

Keep application-specific context, authorization, billing, prompts and storage
placement in application subclasses or adapters. Shared tool helpers preserve
the application's context type; applications need not copy their implementations.

The pinned Agents SDK currently needs `sdkNodeCompatibility.d.ts` for strict
Node declaration checking. It describes the SDK emitter through its own event
contract and does not replace runtime code or augment Node globally. Staging
ships that declaration and rewrites its reference to the installed location.
Remove the shim when the unmodified SDK passes the packed consumer with
`skipLibCheck: false`; do not disable the check to upgrade the dependency.

Framework maintainers run `npm run test:service --workspace @db3.ai/app -- ai`.
Tests use real App, SDK, SQL and Storage with synthetic provider responses. The
integration suite covers tools, history, ownership, queue reconstruction, nested
request parentage, failover, image storage, embeddings and structured output.
Limiter contention tests use disposable MariaDB and independent persisted-state
reads to verify deadlock recovery, retry exhaustion, cleanup and preservation of
provider success, rejection, deferral and transport failure. A real ambient
deadlock regression also verifies rollback of an earlier caller write, error
propagation and the absence of follow-up limiter queries in that transaction.
The package is also installed and type-checked in an independent consumer.
`tests/agentAdmission.integration.test.ts` checks acknowledged job IDs, duplicate
submissions and execution-before-acknowledgement against SQL and Redis. Set
`QUEUE_REDIS_URL` to an isolated Redis instance and `TEST_REDIS_REQUIRED=1` for
the combined driver gate; required Redis infrastructure must not be skipped.

Installed app developers run their own tests using a disposable database and
an injected `ai.fetch`. No live key is needed for simulated provider tests.
See the [AI guides](https://db3.ai/docs/ai) for app-focused examples.

The SSE observer recognizes successful completion only after an explicit
`response.completed` event or compatible `[DONE]` marker, a complete event
boundary and clean body EOF. It joins multiline `data` fields and supports LF,
CR and CRLF across arbitrary UTF-8 byte fragments while forwarding original
bytes unchanged. Malformed JSON, uncertain UTF-8, oversized events, incomplete
EOF and cancellation do not reset the request's retry backoff. Retained lines
and events are limited to one MiB of decoded characters; oversized events are
discarded only by the observer until their blank boundary. Recognized quota
and transient errors terminate that request's stream with typed diagnostics.

### Queued tool continuation

A queued retry restores the current run's persisted tools and results after its
original task input. The earlier-conversation history limit does not truncate
that run's research. Completed tools are supplied as history, not executed again.
Applications can override `recoverQueuedToolCall(message, rootRequest)` to resolve
an interrupted tool against a durable operation and return its final tool result.
The runtime persists that result under the original call id before contacting the
model. Returning `undefined` retains the normal interrupted-tool error; arbitrary
side effects are never replayed automatically. Recovery runs before model capacity
admission. The application must validate operation ownership and await or recover
only work it can safely identify. This is history continuation, not a guarantee
that an external provider side effect occurs exactly once.
