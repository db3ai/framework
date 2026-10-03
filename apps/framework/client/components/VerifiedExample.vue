<script setup lang="ts">
import { DomButton } from '@getdom/studio/vue';
import { CheckCircle2, Terminal } from '@lucide/vue';
import { ref } from 'vue';
import type { VerifiedExample } from '../docs';

const props = defineProps<{
	example: VerifiedExample;
}>();

const commandState = ref<'idle' | 'copied'>('idle');

/**
 * Copies the framework-checkout test command and confirms the interaction inline.
 */
async function copyRunCommand(): Promise<void> {
	await navigator.clipboard.writeText(props.example.command);
	commandState.value = 'copied';
	window.setTimeout(() => {
		commandState.value = 'idle';
	}, 1800);
}
</script>

<template>
	<section id="verified-example" class="verified-example" aria-label="Verified example">
		<header class="verified-example-header">
			<div class="flex flex-wrap items-center gap-3">
				<span class="verified-status">
					<CheckCircle2 :size="17" aria-hidden="true" />
					Behaviour tested
				</span>
				<span class="text-xs text-muted-fg">Includes a runnable test</span>
			</div>
			<DomButton variant="secondary" size="sm" @click="copyRunCommand">
				<Terminal :size="15" aria-hidden="true" />
				{{ commandState === 'copied' ? 'Command copied' : 'Copy repository test' }}
			</DomButton>
		</header>

		<div class="verified-example-grid">
			<div>
				<strong>What this does</strong>
				<p>{{ example.description }}</p>
			</div>
			<div>
				<strong>Expected output</strong>
				<code>{{ example.expectedOutput }}</code>
			</div>
			<div>
				<strong>Behaviour test</strong>
				<code>{{ example.testPath }}</code>
				<p>This test command requires the framework repository. Use the walkthrough commands in an installed application.</p>
				<p>Environment: {{ example.environment }}</p>
			</div>
		</div>
	</section>
</template>
