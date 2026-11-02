# Flows

A flow is a file in the app's repo, `db3/flows/<name>.flow.json`, that wires the app's
blocks into a durable, observable process on the queue. Every app has `app().flows`; pass
code blocks with `new App({ flows: { blocks } })` and install `QueuedJob`, `FailedJob` and
`...FLOW_MODELS`. The visual editor (`FlowEditor` in `@db3.ai/flow-designer`) edits the same
files in Dock, in Cloud and in an app, so simple flows can be sketched with a client and
then run as they are.

## Runnable flow and testing

Copy the installed package's `src/flows/examples/` into `examples/`, then run
`npx tsx examples/runTextFlow.ts` with disposable SQL credentials. It creates and removes
its own test database and flows folder. Two blocks normalize and format text; the lab checks
steps, progress, a failure on blank input and original/latest replay after a repair. The
website includes the exact `tests/examples/runTextFlow.test.ts` consumer test.

## The flow file

```json
{
	"schemaVersion": 2, "id": "01JD7V0Q8M4V7K9R2S6T3W5X1Y", "name": "lead-intake",
	"inputs": { "email": { "type": "string", "required": true } },
	"outputs": { "kind": { "type": "string", "value": "{{classify.kind}}" } },
	"steps": {
		"classify": { "type": "app.classify-lead", "config": { "email": "{{input.email}}" } },
		"crm": { "type": "app.add-to-crm", "config": { "apiKey": { "secret": "CRM_KEY" } } }
	},
	"edges": [["input", "classify"], ["classify.lead", "crm"]]
}
```

- Steps are keyed by readable names; `edges` say only what runs after what. `layout` keeps
  canvas positions last, so moving a box leaves the logic untouched.
- References: `{{input.x}}`, `{{step.field}}` (only steps that run before this one), `{{env.X}}`.
  A setting that is exactly one reference keeps the value's type. Secrets are written
  `{ "secret": "NAME" }` and show as `[secret NAME]` in run history.
- Exits: a block declares `exits` (or `exitsFor(config)`) and returns `exit(name, values)`.
  Edges leave through `step.exit`. Every step also has an `error` exit: after its last
  retry, a step with an `error` edge takes it (output `{ error: { name, message } }`) and the
  run carries on; without one the run fails. `control.switch` and `control.if` are built in.
- Branches: a step is queued once any edge into it is taken and the rest are decided, and
  skipped when none is. Steps on separate branches run side by side as separate jobs.
- Checks: `saveDefinition` and `definition` run `FlowGraphCompiler`, which rejects unknown
  block types and settings, missing exits, loops, unconnected steps, and references to
  steps that do not run first or outputs they do not have.

## Blocks

A code block is one `defineBlock` with named inputs, outputs, settings and one function:

```ts
import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

export default defineBlock<FlowValues & { text: string }, FlowValues & { text: string }>({
	type: 'text.uppercase',
	name: 'Uppercase',
	inputs: { text: { type: 'string', required: true } },
	outputs: { text: { type: 'string', required: true } },
	run: input => ({ text: input.text.toUpperCase() }),
});
```

A step's `config` supplies the block's inputs and settings. The context gives the run and
step and a durable `log(level, message, data)`. Keep database work in app-owned blocks
with scoped models; there is no generic SQL block. `editor` hints on a value (label,
placeholder, rows, component) shape forms without changing validation.

Built in: `control.switch`, `control.if`, `agent.run` (an agent from `db3/agents`; with
`returns` it answers in fields, and `exitOn` picks the exit from one of them), and two
steps that use another flow: `flow.run` waits for its outputs, `flow.start` carries on at
once with the new `runId`. Their settings are the other flow's inputs.

## Starting, runs and replay

```ts
const run = await app().flows.start('lead-intake', { email });
const details = await app().flows.runDetails(run.id!);
const { runs, total } = await app().flows.findRuns(run.flowId!, { status: 'failed', page: 1 });
await app().flows.replay(run.id!, { definition: 'original' });
```

Each run keeps a snapshot of its flow file. Replay with `original` uses the snapshot;
`latest` reads the file again. The snapshot holds settings, not code: version block types
when a change would break old runs, and make side-effecting blocks idempotent. Values at
every step are captured (up to one megabyte), so keep credentials out of them.

## Triggers

Name triggers in the flow file; the running app serves them once it registers the routes:

```ts
import { registerFlowTriggerRoutes } from '@db3.ai/app/flows/fastify';
await registerFlowTriggerRoutes(server, () => app().flows.triggers);
await app().flows.triggers.schedule(app().scheduler); // in the scheduler process
```

```json
"triggers": {
	"website": { "type": "trigger.webhook", "config": { "token": { "secret": "LEAD_WEBHOOK_TOKEN" } } },
	"contact": { "type": "trigger.form", "config": { "title": "Contact us", "thanks": "Thanks!" } },
	"nightly": { "type": "trigger.schedule", "config": { "every": "day", "at": "07:00" } }
}
```

- Webhook: `POST /_db3/flows/<flow>/<trigger>` with `Authorization: Bearer <token>` and the inputs
  as a JSON object; answers 202 with the run id. An `Idempotency-Key` header returns the first
  run for a retry and refuses the same key with other inputs (`FlowTriggerDelivery`).
- Form: `/_db3/flows/<flow>/<trigger>/form` is a page built from the flow inputs (labels from
  `editor` hints), embeddable in an iframe (`embedOn` limits where), with a hidden honeypot and
  an optional Turnstile check (`turnstileSiteKey`, `turnstileSecret`). Sending it starts a run.
- Schedule: `every` minute, hour or day (`at` a time, optional `timezone`), with fixed `input`.
  Weekly and cron schedules are not supported yet.

## Where flow files live

`FileFlowDefinitionStore` reads `*.flow.json` files, writes them with a stable key order
and tabs, and uses SHA-256 revisions for optimistic saves. Give it a `root` folder, or a
`FlowFileSource` (`list`, `read`, `write`) for files kept elsewhere, such as Cloud's git
branches. `ConsoleFlowRuns` (in `@db3.ai/app/console`) reads runs with plain SQL for hosts
that reach the app's database without running the app.
