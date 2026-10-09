<script setup lang="ts">
import { FlowDesigner } from '@db3.ai/flow-designer';

import { FlowLabClient } from './FlowLabClient';

const client = new FlowLabClient();
const sampleFlowId = '01KXDVYBKNBPTHGME52391YBVB';
</script>

<template>
	<FlowDesigner :client="client" :initial-flow-id="sampleFlowId" title="Flow Lab" />
</template>
