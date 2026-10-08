# Framework managed Flex execution plan

Status: Draft for review. No implementation or production enablement is authorized by this document.
Date: 7 October 2026.
Owner: db3.ai framework AI service in packages/app/src/ai.

## Intended contract

Selecting serviceTier: 'flex' on an existing framework AI operation should be sufficient. The framework owns provider parameter mapping, suitable request timeouts, bounded safe retries, continuation of queued agents, usage capture and correct cost calculation. The application receives its existing result or stream, ordinarily after a longer wait. Applications should not implement OpenAI retry loops or apply pricing multipliers.

Slower success is the normal experience, not an unconditional completion guarantee. Cancellation, exhausted budget, invalid requests, unavailable capacity beyond the deadline and uncertain external side effects still produce explicit terminal outcomes. Do not hide these as successful empty results.

Batch submission is a different execution API and is excluded. No Batch jobs, file upload, polling or batch image work belongs in this change. The current image and embedding execution paths are not automatically assigned Flex.

## Existing implementation and specific gaps

- Ai.ts builds direct OpenAI Responses requests with service_tier: 'default'.
- Agent.ts modelSettingsForProvider also forces Standard for every agent request.
- Ai.ts configures the OpenAI client with timeoutMs defaulting to 60,000 and maxRetries: 0.
- AIProviderAdmission.ts implements account-wide transient outage handling with a default 900-second failure episode. This is distinct from per-model rate limits.
- Agent.ts permits selected retries of a later request inside the live SDK run. The retry limit is eight; emitted current-request events and stateful requests restrict replay. That in-memory mechanism is not durable agent continuation.
- QueuedAgentRunPayload retains constructor state, input and model, but not a complete SDK execution checkpoint.
- modelPricing.ts calculates Standard costs. AIRequestCostUsageEntry has token counts and an optional endpoint, but no actual tier or pricing provenance.
- AiRequest.runCostSummary aggregates request trees. Orchestration roots have zero own cost; provider attempts and tools retain their own costs.
- The installed Agents SDK exposes serializable RunState. Safe resumability at the exact required boundaries must be demonstrated before selecting the implementation.
- Queue reservations renew during execution. Their lease duration is not a hard job timeout.

These observations are implementation context, not a promise that changing one parameter is safe.

## Public API changes

Add AIServiceTier = 'standard' | 'flex' | 'fast' in contracts/AIServiceTier.ts and export it through the AI public barrel.

Use the same camelCase serviceTier option on direct text/structured inputs, AI service defaults and agent execution options. Map standard to OpenAI's default, flex to flex and fast to the supported provider value. Preserve the raw returned tier separately; normalize priority/fast aliases using the provider/model contract.

Illustrative proposed direct-call API:

```ts
const result = await app().ai.generateStructured({
	instructions,
	input,
	schemaName,
	schema,
	serviceTier: 'flex',
});
```

Agent selection should use the existing agent configuration/run-options surface with the same serviceTier property. Do not add a second runner or require SDK providerData knowledge. Determine the exact agent property signature during the contract increment and cover it in the packed consumer test.

Resolution order: explicit run/call override, agent default, service default, Standard. Persist the resolved policy at queue admission. Existing queued payloads without the new property resolve to their previous Standard behaviour.

The model-name-only AIConfig remains model configuration; do not mix structured execution policies into its string index signature.

Provider/model capability validation must happen before paid execution. Do not pass OpenAI-specific fields to other providers. Explicit unsupported tier requests fail clearly; cross-provider failover must not silently discard a selected tier.

Eligible nested text operations inherit the current execution policy through AiExecutionContext; explicit child overrides take precedence. Preserve the original absolute run deadline. Detached work needs its own captured policy. Images, embeddings and external tools do not inherit unsupported tiers.

## Internal execution policy

Add a service-owned resolver, resolveAIExecutionPolicy.ts, with a typed AIExecutionPolicy contract. Normal callers only select serviceTier. Advanced applications may set deadlines, cancellation or explicitly allow a costlier fallback; they do not supply retry algorithms.

Proposed initial Flex defaults to validate:

| Concern | Default proposal |
| --- | --- |
| Per-request timeout | 15 minutes, capped by remaining operation deadline |
| Total Flex operation deadline | 6 hours |
| Capacity retry delay | Exponential backoff with jitter, initially 30 seconds, capped at 5 minutes |
| Attempt bound | A finite capacity-attempt cap as well as the absolute deadline; settle exact value using simulated timelines |
| More expensive fallback | Disabled |
| Model and reasoning effort | Unchanged |
| Cancellation | Stops future attempts and propagates to the active request |

Standard retains existing behaviour unless an independently tested fix is required. Fast uses appropriate request handling but is not treated as a discount mode.

The six-hour deadline covers the logical operation, not each retry or queue delivery. Agent turn budgets and tool budgets survive continuation. A per-call timeout must not grant extra elapsed time beyond the parent deadline.

Requests using Flex must not silently upgrade to Standard to improve completion. If explicitly enabled, fallback applies to the unfinished safe request, records the reason and actual tier, and is evaluated against the remaining budget. Do not replay the whole article.

Application HTTP/proxy timeouts remain outside the AI service. Direct await calls keep their existing Promise contract and occupy their caller while waiting. Queued agents use durable continuation and release workers. The framework must not secretly transform a direct call into a queued job or change its return type. Document that long jobs should use the existing queue API.

## Request execution and retry ownership

Refactor shared execution behaviour into a cohesive AIRequestExecutor owned by the AI service. Ai.ts and the agent provider adapter call this boundary; they must not maintain independent nested retry loops.

Before extraction, prove the SDK integration can retry/resume the exact failed model request without repeating preceding tools. Preserve the current stream replay veto until its replacement has equivalent or stronger tests.

Classify errors using provider status and stable codes, not broad message matching:

| Failure | Behaviour |
| --- | --- |
| Recognized Flex capacity rejection | Retry within the Flex policy; do not trip the account-wide outage breaker |
| Model/account rate limit | Respect provider reset information and remaining deadline |
| Transport or transient server failure | Retry only at an established safe boundary |
| Quota exhaustion, authentication or invalid request | Stop under existing security/billing rules |
| Failure after current-request streamed events | Recover only through a proven continuation mechanism; otherwise stop explicitly |
| Unknown result of a side-effecting tool | Reconcile via that tool's stable identity; do not blindly execute again |

Retain account-wide quota protection and real outage admission. Add a separate model/tier capacity policy only where needed; do not split provider limits that are actually shared across tiers. Flex capacity scarcity must not block Standard traffic.

Align recovery leases with the actual resolved request timeout and event-loop heartbeat behaviour. Do not globally enlarge the outage deadline as a substitute for this design. Ensure only one retry layer owns attempt counts and delays, including any SDK retries.

Cancellation during backoff, app shutdown and total deadline expiry must prevent a new provider call. A timeout after submission is not automatically evidence of zero provider cost.

## Durable agent continuation

Add a versioned AiAgentCheckpoint model and framework-owned queued continuation integration. Use SDK RunState if the validation spike establishes a supported stable boundary. Reconstruct runtime-only retry policies and registered tools after deserialization; never serialize closures, credentials or live model objects.

Checkpoint contents:

- Logical root request, owning scope and checkpoint revision.
- Versioned SDK state, exact next model input and required reasoning state.
- Tool call identities, completed results and references to pending operations.
- Remaining turn budget and cumulative retry accounting.
- Captured model and execution policy, original start/deadline and next eligibility time.
- Usage already committed, request identities and cancellation/fencing state.

Persist checkpoints after completed model responses and completed tool operations, before advancing to another paid operation. Persist the continuation and queue transition atomically using supported database queue semantics. A conditional revision/lease token prevents duplicate workers advancing the same checkpoint.

Checkpoints are private execution data. Enforce app scope access, redaction in logs and bounded retention; do not return raw state in ordinary progress APIs.

Resume only the unfinished boundary. Do not rebuild from the initial user prompt or assume that display conversation history is an exact continuation state.

Tool contract additions must explicitly distinguish replayable reads, idempotent writes and operations requiring reconciliation. Use durable tool execution receipts keyed by logical run and tool call identity; determine whether a dedicated AiToolExecution model or an existing supported durable record is the smallest sufficient owner during the spike. Persist pending intent before execution and completion/result afterwards. For an unknown external outcome, reconcile or stop.

A tool that committed an external side effect just before a crash cannot become exactly-once merely through checkpointing. Existing Scout image-intent identities and article persistence guards should integrate with this contract.

Initial scope is the tool types used by Scout article agents plus existing direct text/structured calls. Do not advertise generic resumability for every computer, handoff or external tool without tests. Unsupported recovery boundaries fail clearly.

## Cost calculation and persistence

Cost must be calculated per physical provider request, using the actual model and actual returned tier, before aggregation. Requested tier is diagnostic evidence, not sufficient proof of what was billed.

Introduce a normalized AiProviderRequest record owned by the AI service, linked to the existing tracked attempt. This record is the atomic usage/cost unit for multi-turn agents and retries; direct calls use the same representation. Final schema is reviewed before migration.

Persist:

- Stable physical-attempt identity, logical operation and parent attempt identity.
- Provider response id when known; deduplicate repeated terminal events for that attempt.
- Endpoint, requested/actual model, requested tier, raw returned tier and normalized effective tier.
- Outcome: not submitted, rejected, completed, failed or unknown after submission.
- Token dimensions, hosted tool counts, measured timings and safe error classification.
- Pricing source/version, applied rate snapshot, complete cost and known subtotal.
- Reason for incompleteness and any documented no-charge classification.

Keep AiProviderRequest outside the existing AiRequest parent-child summation. Existing AiRequest attempt costs become projections of their provider request records; request-tree totals continue to sum each attempt once. Do not count the new records again as billable child AiRequest rows.

Create provider request intent before transport, settle after authoritative usage arrives, and retain incremental completed-turn usage before the next turn. Unknown outcomes must survive a worker crash as unknown, not disappear from the cost ledger.

Extend contracts/Pricing.ts and modelPricing.ts to resolve provider/model/endpoint/tier rate cards, cache rates and request-local long-context thresholds. Extend estimates to use the same resolver. Do not multiply the complete article or provider attempt by 0.5.

Rules:

1. Price each request at its effective tier; a single run may mix tiers.
2. Do not discount hosted search fees, images or other providers merely because their parent used Flex.
3. Preserve cached-read/cache-write dimensions and apply long-context thresholds per request.
4. Count reasoning in the provider's output-token accounting, never twice.
5. Confirmed uncharged capacity rejections and pre-transport failures may have known zero cost.
6. A timeout or incomplete stream with uncertain usage remains unpriced, with any known subtotal retained.
7. Deduplicate repeated delivery of the same completion; distinct paid retries remain distinct costs.
8. Preserve authoritative provider-reported dollar costs where already supported.
9. If effective tier or another billable dimension is unresolved, retain unknown complete cost rather than assuming the requested discount.
10. Capture applicable regional/rate modifiers when known; unsupported billing dimensions must remain visible limitations rather than a claim of invoice accuracy.
11. Existing stored costs are immutable; no historical repricing or default historical Flex attribution.

Extend cost summaries with a breakdown by tier and cost component, pricing completeness and fallback counts. Preserve totalCostUSD's existing meaning as a known subtotal when unpriced rows exist. Keep invoice amounts distinguishable from locally calculated estimates.

For savings reporting, compute a Standard counterfactual from the same measured per-request usage and applicable rate card. Label it an estimate; it is not proof of what a separate Standard execution would have consumed.

Customer credits remain application policy. Framework cost changes must flow through existing settlement hooks exactly once. Retry and continuation must not create another allowance charge. Scout articles retain their one-article charge; usage-priced General AI work uses its existing rounding/minimum policy with the corrected provider-cost totals.

## File ownership and proposed changes

Paths below are relative to packages/app/src/ai unless stated otherwise.

| Owner | Change |
| --- | --- |
| contracts/AIServiceTier.ts; contracts/AIExecutionPolicy.ts | New tier and resolved execution-policy contracts |
| contracts/AI.ts; contracts/Agent.ts; index.ts | Public options, precedence, queued policy serialization and exports |
| resolveAIExecutionPolicy.ts | Central defaults, inheritance and capability validation |
| Ai.ts; Agent.ts | Delegate execution and pricing; remove forced Standard only through the new resolver |
| AiExecutionContext.ts | Carry resolved policy to eligible nested text calls |
| AIRequestExecutor.ts | Shared bounded execution, cancellation and retry ownership |
| AIProviderAdmission.ts; OpenAIProviderError.ts; AIProviders.ts | Correct error classification, separate Flex scarcity and provider-safe settings |
| AgentRunJob.ts; registry.ts | Restore checkpoint references and runtime policies |
| AiAgentCheckpoint.ts; agent checkpoint helpers | Versioned durable state, fencing and continuation |
| AiProviderRequest.ts | Durable per-provider-request usage and cost records |
| contracts/Pricing.ts; modelPricing.ts; Estimates.ts | Tier-aware rate cards and estimates |
| ProviderCosts.ts; ProviderSseObserver.ts | Preserve billed-cost precedence; capture terminal tier/usage without altering stream content |
| AiRequest.ts; contracts/AiRequestRunCostSummary.ts | Derived attempt totals and nonduplicating cost breakdowns |
| README.md; examples/; tests/ | Supported API, behavioural guarantees and regression coverage |

Prefer extending existing cohesive services. New modules above identify ownership, not permission to create generic utility layers. All implementation follows tabs and production-standard docblocks.

## Schema compatibility and rollout

Framework owns model definitions and service tests. Consuming applications own their migration registries and committed migrations. Scout overrides AiRequest, so inherited and overridden fields must be checked explicitly rather than assuming framework schema changes appear automatically.

Use additive tables/fields and versioned payloads. Old queued jobs retain Standard behaviour; old request rows continue using their saved costs. Do not fabricate provider-request detail for historical aggregate rows.

Ship readers, migrations and compatible workers before enabling producers of new checkpoint formats. Choose worker routing or a coordinated transition so old workers cannot claim unsupported new jobs. Disabling Flex stops new Flex admissions but compatible workers must finish or explicitly terminate existing checkpoints. Retain that compatible consumer while draining before rollback to older code.

No production switch is included in implementation commits by default.

## Verification and acceptance criteria

Use real framework SDK integration, disposable SQL, real queue drivers and simulated external provider responses. No paid requests are necessary for deterministic correctness tests.

Required tests:

- serviceTier alone selects managed defaults for direct, structured and agent calls; existing result types remain unchanged.
- Standard remains the default and unsupported provider/model combinations fail before transport.
- Nested text inheritance and explicit overrides work without leaking across concurrent runs.
- Mixed Flex/Standard/Fast rates, raw priority alias, cached reads/writes, long-context boundaries and fallback estimates are correct.
- A response reporting a different tier is priced at that tier.
- Missing usage/tier, repeated terminal events, uncharged rejections and ambiguous timeouts have correct completeness.
- Retry after several successful tools repeats only the unfinished request.
- Crash/restart at every model/tool/persistence boundary does not duplicate a saved article, image or customer charge.
- Completed request costs survive later failure, continuation and settlement retry.
- Duplicate queue delivery and lost leases cannot advance a checkpoint twice.
- Capacity waiting releases queued workers and does not reset deadlines or turn budgets.
- Standard traffic continues during Flex scarcity; quota exhaustion retains existing stop behaviour.
- Cancellation, shutdown, total deadline and optional fallback budgets are enforced.
- Partial streams are not automatically replayed; observable events are not duplicated on continuation.
- Tool side-effect uncertainty produces reconciliation or an explicit terminal outcome.
- Legacy rows/payloads and migration/rollback sequencing preserve existing execution and reports.

First run focused AI tests; include queue tests for changed lifecycle contracts. Before handoff run required framework check/test/release gates, conventions and the independent packed-package TypeScript/runtime consumer test. Validate Scout's article generation, images, credit settlement and job history against the linked source, then against the captured and unlinked snapshot. Update current documentation only when behaviour actually exists.

## Safe implementation sequence

1. Contract and SDK proof: validate serialization/resume, streaming boundaries and per-response tier/usage capture. Stop and revise the design if supported SDK boundaries cannot deliver the contract.
2. Accounting foundation: rate cards, provider-request records, projections and migration tests, with Standard execution unchanged.
3. Managed direct execution: Flex/Fast options, timeout resolution and safe retries; no Scout enablement.
4. Durable queued agents: checkpointing, tool receipts, cancellation, exact continuation and crash tests.
5. Scout adoption: select Flex for scheduled article text work, use existing billing/publishing boundaries, and leave manual/onboarding policy explicit.
6. Controlled release: after separate implementation/release approval, compare completion, cost completeness, cost per saved article, wait time and fallback incidence on a limited cohort before broader activation.

Review gates after steps 1, 2 and 4 are technical acceptance gates, not automatic permission to deploy. This plan does not authorize implementation, schema changes, paid trials or production enablement.

## Provider references

- [Flex processing](https://developers.openai.com/api/docs/guides/flex-processing)
- [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)
- [API pricing](https://developers.openai.com/api/docs/pricing)

Revalidate provider capabilities and rates during implementation. None of the proposed defaults is an OpenAI completion guarantee.
