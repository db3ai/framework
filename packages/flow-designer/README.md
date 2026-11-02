# @db3.ai/flow-designer

`FlowEditor` edits an app's `db3/flows/<name>.flow.json` files: a block
library, a canvas of named steps (drag from a dot onto a box to connect it; exits such as
`spam`/`lead` and every step's `error` exit have their own dots), a settings panel, and a
step detail view with earlier steps' values on the left (click one to insert its
`{{reference}}`), settings in the middle and output on the right. Check flow and Save show
problems on the boxes. The Runs view lists runs with search, a status filter and pages,
and paints the chosen run onto the canvas. The File view shows the file as saved.

```vue
<script setup lang="ts">
import { FlowEditor, type FlowEditorClient } from '@db3.ai/flow-designer';
import '@db3.ai/flow-designer/editor.css';

const client: FlowEditorClient = { catalog, definition, save, runs, run, runDetails, replay };
</script>

<template>
	<FlowEditor :client="client" initial-flow="lead-intake" />
</template>
```

The run methods are optional; the console (Dock and Cloud) edits files only. Colours come
from the host's theme tokens (`--canvas`, `--border`, `--primary`, …).
