# Flow Lab

Flow Lab is an isolated framework example application for developing and testing flows. It has its own `App`, `app().flows`, database connection, database queue worker, file-backed definitions, Fastify API, and reusable Vue Flow designer.

The project-scoped product lives in `db3.ai/apps/flows`. This lab retains deterministic article demonstrations and standalone runtime tests; it is not the hosted product.

## Run Locally

Create a local database named `platform_flow_lab`, then configure the app:

```sh
cp apps/flow-lab/.env.example apps/flow-lab/.env
npm run dev:flow-lab
```

Open [http://127.0.0.1:5178](http://127.0.0.1:5178). The API runs on `127.0.0.1:8788`, and the development command starts a worker for the `flows` queue after the API is healthy.

## Sample Graphs

Each example includes visible `flow.input` and `flow.output` boundaries. Their named ports are the definition's public contract, and generic `flow.subflow` occurrences derive their handles from the referenced child definition.

The default example is `server/flows/article-generation/flow.json`:

```text
Validate Entitlements -> Fetch User and Plan -> Build Editorial Context
	-> Research and Select Links -> Produce and Finalize Article
	-> Persist Approved Article
```

`Research and Select Links` opens `server/flows/article-research-agent/flow.json`:

```text
Deep Keyword Research -> Find Internal Candidates -> Find Exchange Candidates
	-> Select Capped Link Plan -> Observe Research and Links
```

`Produce and Finalize Article` opens `server/flows/article-writing-agent/flow.json`:

```text
Generate Article Plan -> Plan Exact Image Set -> Write With Stable Anchors
	-> Generate Planned Images -> Place Images Inline -> Weave Links Naturally
	-> Validate and Finalize
```

The article request is a definition-driven JSON input with seeded `userId`, `contentPlanId`, and `imagePolicy` values. Every article receives exactly one title image. `bodyImageCount` must be at least two and can use the four included body-image slots plus `paidExtraImageAllowance`; when `requireDiagram` is enabled, the first body slot is a diagram rather than an unplanned extra image.

The research subflow reads seeded pages from isolated website owners. Same-owner pages become internal candidates. Pages owned by another user are eligible only when their backlink-exchange flag is enabled. Selection drops weak candidates and freezes no more than three internal links and one external link. The writing block includes those anchor phrases naturally in the relevant copy before a separate block converts them into markdown links.

The finalization block is a hard persistence gate. It rejects missing or misplaced title images, incorrect body-image counts, a missing configured diagram, unresolved placeholders, and links beyond the editorial caps. `database.insert-article` runs only after approval and returns the persisted article together with title/body/diagram URLs, inserted links, and validation metrics.

Database reads, link discovery, placement, validation, and persistence are real Flow Lab behavior. AI writing, keyword research, and image-generation blocks remain deterministic demonstrations of future provider-backed boundaries; they do not call external providers yet.

`server/flows/daily-content-planner/flow.json` demonstrates scheduled orchestration:

```text
Every Day -> Ensure 30 Days Planned -> Pick Next Article -> Article Generation -> Daily Result
```

It fills a rolling set of demo content-plan rows, selects the next planned item, and invokes the complete Article Generation flow as a nested block.

The original greeting graphs remain as the smallest executable example.

`server/flows/greeting-debug/flow.json` is the parent example:

```text
Manual Input -> Require Name -> Greeting Agent -> Flow Output
```

`Greeting Agent` is a generic `flow.subflow` block. Double-clicking it opens `server/flows/greeting-agent/flow.json`:

```text
Agent Input -> Build Greeting -> Debug Tap -> Wait -> Uppercase -> Agent Output
```

Run the parent with the default `Ada` input. The parent visibly waits while the child executes, then returns `HELLO, ADA!`. Selecting any block shows its captured input, output, attempt, timing, error, and logs. Replay snapshot uses the original parent and child definition snapshots; Replay latest resolves both current files.

To sketch a new grouping, drag `Subflow` from the block palette, name it, and connect its fallback JSON port. The first double-click creates a sibling child definition with visible input/output terminals, links it to the parent occurrence, saves the parent, and opens the child. Select either terminal to add or configure the public ports that should appear on the parent block.

Click a connection arrow to inspect its source and target ports plus the exact value carried by the selected run. The connection inspector can insert a contract-compatible pass-through block that declares `insertable: true`, such as another wait timer or debug listener, and automatically rewires the serialized graph while shifting downstream blocks to leave usable spacing. The block inspector displays both the stable block type and its execution kind.

Run inputs are rendered from the flow's public value definitions. Primitive values use native controls and `object`, `array`, or `json` values use validated JSON textareas. Optional `editor` metadata can name host components such as `DomTextInput` and `DomJsonInput`; this gives Scout a clean path to render the same definitions through DOM form components later.

Saving in the designer atomically rewrites the same Git-controlled definition file used by the runtime.

## Verification

```sh
npm test --workspace flow-lab
npm run build --workspace flow-lab
npm run check --workspace @db3.ai/flow-designer
```

The integration tests use disposable generated databases and execute greeting, article-production, and scheduled nested flows through Fastify and the real database queue. Focused article tests cover included and paid image entitlements, optional diagrams, exact image placement, natural link insertion, and the three-internal/one-external caps. The suite also covers graph connection insertion and real demo model reads/writes.
