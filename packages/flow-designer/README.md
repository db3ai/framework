# @db3.ai/flow-designer

Reusable Vue Flow editor and run inspector for `@db3.ai/app/flows`.

The component is transport-neutral. A host supplies a `FlowDesignerClient` adapter for listing, loading, saving, invoking, observing, and replaying flows:

```vue
<script setup lang="ts">
import { FlowDesigner } from '@db3.ai/flow-designer';
import { client } from './flowClient';
</script>

<template>
	<FlowDesigner
		:client="client"
		initial-flow-id="01KXDNZE8JYH73Z55DA8QKCDM8"
		title="Flow Lab"
	/>
</template>
```

Import the package stylesheet once in the host entrypoint:

```ts
import '@db3.ai/flow-designer/style.css';
```

Graph operations update a complete in-memory `FlowDefinition`; Save writes that definition through the host adapter with optimistic revision protection. The UI supports named-port connections, block drag/drop, node positioning, block/config editing, nested double-click navigation, recent runs, live polling, block input/output/log/error inspection, and original/latest replay.

`flow.input` and `flow.output` render as visible boundary terminals. Selecting one opens a flow-interface editor for adding ports and changing their labels, value types, and required state. Port keys remain stable while labels are edited so existing connections are not silently broken. These public contracts also drive generated run-input controls and the handles shown by every parent subflow occurrence.

Dropping `flow.subflow` creates a connectable placeholder with a fallback JSON port. Give it a useful name and double-click it to create and open a child `flow.json` containing connected input/output boundaries. Once linked, the placeholder's handles are resolved from the child definition. Breadcrumbs navigate back through arbitrary nesting, and double-clicking a subflow during an observed run opens its linked child run rather than an unrelated latest run.

Selecting a connection opens a right-hand inspector with endpoint schemas and the exact source-port value carried by the selected run. A compatible function block that explicitly declares `insertable: true` can be inserted directly on that connection; the graph replaces the edge with two serialized connections and creates enough downstream spacing for the new node. Wait and passive debug blocks are good insertable candidates because they preserve the carried value. Selecting a block shows its stable registered type and whether it is function-backed or flow-backed.

Run inputs are generated from `FlowDefinition.inputs`. Structured values use validated JSON editors that disable Run while invalid. `FlowValueDefinition.editor` hints supply labels, placeholders, textarea rows, and optional host component names such as `DomTextInput` or `DomJsonInput` without coupling this package to a form library.

The designer is a development surface, not a second runtime. It never compiles or executes a separate graph model. The current runtime still accepts one connected sequential path; independent branches and merges remain outside this first scheduler contract.
