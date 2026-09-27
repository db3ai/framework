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
Flare image buckets use a conservative local fallback of five requests per
minute when response headers omit capacity; this is an admission policy, not
an assertion about the account's provider tier. Observed headers remain authoritative.
An image attempt deferred before provider execution is finalized in the audit
trail rather than left pending. Queue owners retain durable waiting state separately.
Quota and capacity deferrals integrate with queue retries. The `allowance` hook
checks application budgets separately. Override `usageCharge()` and
`settleUsage()` in an agent when your app needs an idempotent commercial ledger.

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
The package is also installed and type-checked in an independent consumer.

Installed app developers run their own tests using a disposable database and
an injected `ai.fetch`. No live key is needed for simulated provider tests.
See the [AI guides](https://db3.ai/docs/ai) for app-focused examples.
