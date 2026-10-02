<script setup lang="ts">
import { DomCodeBlock } from '@getdom/studio/vue';
import { CheckCircle2, Copy, ListChecks } from '@lucide/vue';
import { ref } from 'vue';
import type { DocCodeSample } from '../docs';
import DocsInlineText from './DocsInlineText.vue';

defineProps<{
	sample: DocCodeSample;
}>();

const copiedTarget = ref<'source' | 'output' | ''>('');

type CodeLanguage = 'html' | 'md' | 'vue' | 'ts' | 'js' | 'bash' | 'txt' | 'css' | 'json' | 'python' | 'sh' | 'sql';

/**
 * Normalizes documentation language names for DOM Studio's highlighter.
 *
 * @param language - Language recorded by the imported example.
 * @returns Supported DOM Studio language identifier.
 */
function codeLanguage(language: string): CodeLanguage {
	if (language === 'typescript') return 'ts';
	if (language === 'javascript') return 'js';
	if (language === 'shell') return 'bash';

	const supported = ['html', 'md', 'vue', 'ts', 'js', 'bash', 'txt', 'css', 'json', 'python', 'sh', 'sql'] as const;

	return supported.includes(language as CodeLanguage) ? language as CodeLanguage : 'txt';
}

/**
 * Copies one example value and briefly confirms the successful action.
 *
 * @param value - Source or output text copied to the clipboard.
 * @param target - Example region whose copy state should be displayed.
 */
async function copyExample(value: string, target: 'source' | 'output'): Promise<void> {
	await navigator.clipboard.writeText(value);
	copiedTarget.value = target;
	window.setTimeout(() => {
		copiedTarget.value = '';
	}, 1600);
}
</script>

<template>
	<div class="docs-live-example">
		<div class="docs-code-wrap">
			<div class="docs-code-toolbar">
				<span>{{ sample.title }}</span>
				<button class="docs-copy-button" type="button" @click="copyExample(sample.code, 'source')">
					<Copy :size="14" aria-hidden="true" />
					{{ copiedTarget === 'source' ? 'Copied' : 'Copy code' }}
				</button>
			</div>
			<DomCodeBlock
				:code="sample.code"
				:lang="codeLanguage(sample.language)"
				:framed="false"
				theme-mode="dark"
			/>
		</div>

		<div v-if="sample.output" class="docs-example-output">
			<div class="docs-example-output-toolbar">
				<span>
					<CheckCircle2 :size="15" aria-hidden="true" />
					Tested output
				</span>
				<button class="docs-example-output-copy" type="button" @click="copyExample(sample.output, 'output')">
					<Copy :size="13" aria-hidden="true" />
					{{ copiedTarget === 'output' ? 'Copied' : 'Copy output' }}
				</button>
			</div>
			<DomCodeBlock
				:code="sample.output"
				:lang="codeLanguage(sample.outputLanguage ?? 'txt')"
				:framed="false"
				theme-mode="dark"
			/>
		</div>

		<div v-if="sample.explanation?.length" class="docs-example-explanation">
			<h3>
				<ListChecks :size="16" aria-hidden="true" />
				How it works
			</h3>
			<ol>
				<li v-for="(item, index) in sample.explanation" :key="item">
					<span>{{ index + 1 }}</span>
					<p><DocsInlineText :text="item" /></p>
				</li>
			</ol>
		</div>
	</div>
</template>
