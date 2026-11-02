<script setup lang="ts">
import { FlowEditor } from '@db3.ai/flow-designer';

import { flowLabClient as client } from './FlowLabClient';

</script>

<template>
	<main class="lab">
		<FlowEditor :client="client" initial-flow="lead-intake" />
	</main>
</template>
