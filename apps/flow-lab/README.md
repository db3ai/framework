# Flow Lab

Flow Lab is an isolated framework example application for developing and testing flows. It has its own `App`, `app().flows`, database connection, database queue worker, file-backed definitions, Fastify API, and reusable Vue Flow designer.

The project-scoped product lives in `db3.ai/apps/flows`. This lab retains deterministic article demonstrations and standalone runtime tests; it is not the hosted product.

## Run Locally

Create a local database named `platform_flow_lab`, then configure the app:

```sh
cp apps/flow-lab/.env.example apps/flow-lab/.env
npm run dev:flow-lab
```

Open [http://127.0.0.1:5178](http://127.0.0.1:5178). It opens `server/flows/lead-intake.flow.json` (file shape 2) in the new `FlowEditor`; its demo blocks are in `server/flow-blocks/LeadIntake.ts`. A message mentioning casino or crypto takes the spam branch, and one containing "fail" makes Page the team fail into its error exit. The API runs on `127.0.0.1:8788`, and the development command starts a worker for the `flows` queue after the API is healthy.

## Sample Graphs

Every example is a `server/flows/<name>.flow.json` file. Values move between steps by `{{step.field}}` references, and a `flow.run` step runs another flow and waits for its outputs.

`server/flows/article-generation.flow.json`:

```text
Validate Entitlements -> Fetch User and Plan -> Build Editorial Context
	-> Research and Select Links -> Produce and Finalize Article
	-> Persist Approved Article
```

`Research and Select Links` runs `server/flows/article-research-agent.flow.json`:

```text
Deep Keyword Research -> Find Internal Candidates -> Find Exchange Candidates
	-> Select Capped Link Plan -> Observe Research and Links
```

`Produce and Finalize Article` runs `server/flows/article-writing-agent.flow.json`:

```text
Generate Article Plan -> Plan Exact Image Set -> Write With Stable Anchors
	-> Generate Planned Images -> Place Images Inline -> Weave Links Naturally
	-> Validate and Finalize
```

The article request is a definition-driven JSON input with seeded `userId`, `contentPlanId`, and `imagePolicy` values. Every article receives exactly one title image. `bodyImageCount` must be at least two and can use the four included body-image slots plus `paidExtraImageAllowance`; when `requireDiagram` is enabled, the first body slot is a diagram rather than an unplanned extra image.

The research subflow reads seeded pages from isolated website owners. Same-owner pages become internal candidates. Pages owned by another user are eligible only when their backlink-exchange flag is enabled. Selection drops weak candidates and freezes no more than three internal links and one external link. The writing block includes those anchor phrases naturally in the relevant copy before a separate block converts them into markdown links.

The finalization block is a hard persistence gate. It rejects missing or misplaced title images, incorrect body-image counts, a missing configured diagram, unresolved placeholders, and links beyond the editorial caps. `database.insert-article` runs only after approval and returns the persisted article together with title/body/diagram URLs, inserted links, and validation metrics.

Database reads, link discovery, placement, validation, and persistence are real Flow Lab behavior. AI writing, keyword research, and image-generation blocks remain deterministic demonstrations of future provider-backed boundaries; they do not call external providers yet.

`server/flows/daily-content-planner.flow.json` demonstrates scheduled orchestration:

```text
Every Day -> Ensure 30 Days Planned -> Pick Next Article -> Article Generation -> Daily Result
```

It fills a rolling set of demo content-plan rows, selects the next planned item, and runs the complete Article Generation flow with a `flow.run` step.

The original greeting graphs remain as the smallest executable example.

`server/flows/greeting-debug.flow.json` is the parent example:

```text
Require Name -> Greeting Agent
```

`Greeting Agent` is a `flow.run` step; double-clicking it opens `server/flows/greeting-agent.flow.json`:

```text
Build Greeting -> Observe Greeting -> Wait 800ms -> Uppercase
```

Run the parent with `Ada`. It waits while the child runs, then returns `HELLO, ADA!`. Opening a step in a run shows its input, output, attempt, timing, error and logs.

Saving in the editor rewrites the same file the runtime reads.

## Verification

```sh
npm test --workspace flow-lab
npm run build --workspace flow-lab
npm run check --workspace @db3.ai/flow-designer
```

The integration tests use disposable generated databases and execute greeting, article-production, and scheduled nested flows through Fastify and the real database queue. Focused article tests cover included and paid image entitlements, optional diagrams, exact image placement, natural link insertion, and the three-internal/one-external caps. The suite also covers real demo model reads and writes.
