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

Direct OpenAI text and agent requests select Standard processing. Estimates
exclude regional processing surcharges and other tiers. OpenRouter and xAI
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
The per-request timeout defaults to 60 seconds; SDK automatic retries are off.

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
Direct text, image and embedding HTTP rejections throw `AIRequestError` with
`code`, `status` and `requestId` when supplied; missing fields remain `null`.
These identifiers exclude the provider payload and inputs. Known quota codes
(`insufficient_quota`, `billing_hard_limit_reached`) and explicit “no credits
remaining” responses are terminal direct-call failures, including code-less
HTTP 429 responses. They do not become queue capacity deferrals. Ordinary
throttling still raises `AIRateLimitDeferredError`. Existing agent quota retry
and configured provider failover policies are separate from this direct-call path.
Capacity deferrals integrate with queue retries. The `allowance` hook
checks application budgets separately. Override `usageCharge()` and
`settleUsage()` in an agent when your app needs an idempotent commercial ledger.

## Provider account admission and recovery

`AIProviderAdmission` shares account availability through a dedicated existing
`ai_rate_limit_buckets` row. Its metadata is keyed by provider, normalized base
URL and a one-way key digest, across models/endpoints and workers. Separate API keys are separate identities even if the provider funds them from the same billing account; the framework cannot infer that relationship. Raw keys,
provider messages and prompts are never stored in this account state. Capacity
limiting can be disabled without disabling account admission.

Explicit `insufficient_quota`, `billing_hard_limit_reached` or “no credits
remaining” responses immediately stop the account. Ordinary 429 capacity stays
with the existing limiter. Network/timeouts/408/5xx and explicit overload/server
errors start one continuous outage episode. Explicit caller cancellation does not
trip an account outage or prove recovery; an existing recovery lease remains
bounded. This lets independently authorized cleanup and later runs continue. `ai.providerAdmission` configures
`initialSeconds` (30), `maxSeconds` (300), `failureWindowSeconds` (900) and
`recoveryLeaseSeconds` (request timeout plus 30). Values must be positive; the
recovery lease must exceed the request timeout. These conservative defaults
limit a fifteen-minute outage to a few real recovery attempts, without assuming
that credits will return automatically or using paid background probes.

After cooldown only one real waiting request owns recovery. A crash leaves a
bounded lease; generations and lease tokens prevent stale successes from
clearing a newer outage or credit stop. The fixed episode deadline also stops
newly dispatched jobs. Expired episodes and exhausted accounts remain stopped
across restarts. `AIProviderDeferredError` releases queue reservations without
spending a try; `AIProviderStoppedError` terminates immediately with a failed-job
record and normal final-failure hooks, even when more tries were configured.
After a completed model/tool turn, agents retry only the current model request
when the SDK has emitted no event for that request. The SDK retains completed
tools and exact current input, waits for shared admission, and allows at most
eight retries inside the existing fifteen-minute episode deadline. Each retry
reacquires capacity and exclusive recovery admission. Queue lease renewal remains
active while this bounded in-process wait occupies the worker; it is not a durable
checkpoint and a worker crash cannot promise continuation. Cancellation, exhausted
quota, stateful requests and any current-request SDK event veto this recovery.
Failures after such events still stop instead of replaying the whole agent.
Saved attempts and results remain.
Terminal errors expose `stopStage`: `quota` for exhausted admission, `deadline`
for expired outage admission, and `stream-output` for an individual run stopped
while the account may still be in cooldown. A streamed-output stop does not
establish that the account deadline elapsed or require resetting the account.
Observed deferrals carry recognized provider codes, rejection HTTP status and
bounded support request IDs into the terminal error; blocked siblings retain
unknown fields. Raw provider messages and payloads are not attached.

After independently repairing availability or credits, an authorized server
operator can select the configured account and reset its admission state:

```ts
const attempt = app().ai.resolveProviders()[0];
if (!attempt) throw new Error('No configured provider account.');
await app().ai.providerAdmission.reset(attempt);
```

This executes no HTTP, changes no key/model/billing setting and dispatches or
replays no job. Failed jobs require a separately authorized retry. The reset
must run on the deployed app/database with trusted server-side configuration;
never expose credentials or this operation to an unscoped client.

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

Installed app developers run their own tests using a disposable database and
an injected `ai.fetch`. No live key is needed for simulated provider tests.
See the [AI guides](https://db3.ai/docs/ai) for app-focused examples.

SSE recovery requires an explicit `response.completed` event or compatible
`[DONE]` marker, a complete event boundary and clean body EOF. The observer joins
multiline `data` fields and supports LF, CR and CRLF across arbitrary UTF-8 byte
fragments; it forwards original bytes unchanged. Malformed JSON, uncertain UTF-8,
oversized events, incomplete EOF and cancellation retain the bounded recovery
lease rather than asserting success. Retained lines/events are limited to one
MiB of decoded characters; oversized events are discarded only by the observer
until their blank boundary, and later valid quota events still stop the account.

### Optional request failure isolation

Text and structured calls may set `transientFailureScope: "request"` for optional work. Timeouts, transport failures and server errors then fail that request without opening the shared account outage circuit. Existing account admission stops and explicit quota exhaustion remain shared. Capacity limits, allowance checks and usage tracking still apply. This does not guarantee provider availability or remove the cost of a request.
