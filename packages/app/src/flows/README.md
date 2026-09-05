# Flows

## Runnable flow and testing

The base `App` does not automatically supply a `flows` property. Copy the
installed package's `src/flows/examples/` into `examples/` to use the explicit
`FlowExampleApp` service extension, then run `npx tsx examples/runTextFlow.ts`
with disposable SQL credentials. It creates/removes its own test database and
file-definition directory. Two blocks normalize and format text; the lab checks
steps, progress, blank-input failure and original/latest replay after repair.
The website includes the exact `tests/examples/runTextFlow.test.ts` consumer
test. A definition snapshot preserves graph/configuration, not executable code;
version block types when changing runtime behavior for historical graphs.

Flows are durable, observable graphs layered over the existing queue. A flow definition is the source of truth for both the runtime and visual designer. It contains stable ULIDs, named input/output contracts, configured block occurrences, named-port connections, and graph positions.

Definitions are intentionally separate from run data:

- A `FlowDefinitionStore` reads and writes source definitions.
- `FileFlowDefinitionStore` stores deterministic `flow.json` files suitable for Git.
- `FlowRun`, `FlowStepRun`, and `FlowRunEvent` persist invocations, every block boundary, logs, failures, timing, and replay lineage.
- `FlowStepJob` executes one block at a time through the application's existing queue.

The initial compiler accepts one connected sequential path. Branches and merges are rejected until their scheduling and replay semantics are explicit.

## App Service

An app exposes its configured service as `app().flows`:

```ts
import { fileURLToPath } from 'node:url';
import { FileFlowDefinitionStore, Flows } from '@db3.ai/app/flows';

class App extends FrameworkApp {
	get flows(): Flows {
		return this.service('flows', () => new Flows({
			queue: this.queue,
			queueName: 'flows',
			definitions: new FileFlowDefinitionStore({
				root: fileURLToPath(new URL('./flows', import.meta.url)),
			}),
			blocks: flowBlocks,
		}));
	}
}
```

`FlowStepJob` resolves that service from the active application when the queue
worker handles it. No flow-specific queue context or service injection is
required.

Install `QueuedJob`, `FailedJob`, and `...FLOW_MODELS` in the app database schema.

## Function Blocks

A function-backed block is one file with a serializable contract and one function:

```ts
import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

type TextValues = FlowValues & {
	text: string;
};

export default defineBlock<TextValues, TextValues>({
	type: 'text.uppercase',
	name: 'Uppercase',
	inputs: {
		text: { type: 'string', required: true },
	},
	outputs: {
		text: { type: 'string', required: true },
	},
	run: input => ({
		text: input.text.toUpperCase(),
	}),
});
```

The block context exposes durable `log(level, message, data)` entries. A debug tap can therefore log input and return it unchanged without introducing a separate instrumentation system.

Database operations should be explicit app-owned block types such as `database.fetch-content-plan` or `database.insert-article`. These blocks use the app's models and ownership rules. The framework deliberately does not expose a generic arbitrary-table or SQL block, because that would bypass model conversion, tenancy, authorization, and reviewable contracts.

## Definition-Driven Inputs

Public flow inputs and block configuration use `FlowValueDefinition`. In addition to runtime type, requirement, description, and default information, a value may carry optional host-agnostic editor hints:

```ts
const request = {
	type: 'json',
	required: true,
	editor: {
		component: 'DomJsonInput',
		label: 'Article request',
		rows: 8,
	},
} satisfies FlowValueDefinition;
```

Editor metadata never changes runtime validation. A host may map component names to DOM form fields, native controls, or another component registry while keeping the flow definition as the source of truth.

## Flow Boundaries And Subflows

Every `Flows` service registers three framework-owned structural blocks:

- `flow.input` exposes the containing definition's public inputs inside the graph.
- `flow.output` terminates the graph and exposes the containing definition's public outputs.
- `flow.subflow` groups another definition behind one generic nested-flow block.

The child definition is the only public-contract source for a subflow. A parent occurrence only needs the generic type and the child ULID:

```json
{
	"id": "01KXDNZE8KRZ9W9AKZAXFEQXPG",
	"type": "flow.subflow",
	"name": "Greeting Agent",
	"flowId": "01KXDPRR0NT39S75V942MEV34X",
	"position": { "x": 625, "y": 44 }
}
```

The compiler resolves that occurrence's named ports from the referenced definition's `inputs` and `outputs`. No app-specific wrapper block is required. The child graph connects its `flow.input` boundary through its implementation to its `flow.output` boundary, so changing the child's public contract updates how every parent renders and validates that subflow.

At runtime the parent step enters `waiting`, a linked child run executes through the queue, and the child output or failure resumes the parent. Execution snapshots include the resolved occurrence contracts and every nested definition. Original-definition replay therefore follows the historical child graph, while latest-definition replay resolves the current child source.

## Running And Replaying

```ts
const run = await app().flows.run(flowId, {
	name: 'Ada',
});

const details = await app().flows.runDetails(run.id!);

await app().flows.replay(run.id!, {
	definition: 'original',
});
```

The runtime captures JSON input and output at every boundary with a default one-megabyte limit. This first version does not redact values automatically, so applications must not pass credentials or unfiltered secrets through captured flow values.

## Definition Providers

`FileFlowDefinitionStore` recursively reads `flow.json` and `*.flow.json`, writes tab-formatted deterministic JSON atomically, and uses SHA-256 revisions for optimistic saves. A future database provider should implement the same `FlowDefinitionStore` contract and store the same definition shape; the runtime must continue to execute definitions rather than a separate UI representation.
