<script setup lang="ts">
import { FlowEditor } from '@db3.ai/flow-designer';

import { FlowLabClient } from './FlowLabClient';

const client = new FlowLabClient().editor();
</script>

<template>
	<main class="lab">
		<FlowEditor :client="client" initial-flow="lead-intake" />
	</main>
</template>
