<script setup lang="ts">
import { computed } from 'vue';
import { DomAiInput, type AiInputDraft, type AiInputModel } from '@getdom/studio/vue';
import type { AiPromptModels } from './aiPrompt';

/**
 * The one box every db3 AI conversation is typed into: getdom's AI input with db3's rules.
 * Enter adds a line, Shift+Enter or the round button sends, and the box grows with its text.
 * Pass `models` to show the model and speed picker; leave it out for a fixed agent.
 */
const props = withDefaults(defineProps<{
	placeholder?: string;
	ariaLabel?: string;
	rows?: number;
	busy?: boolean;
	disabled?: boolean;
	canSend?: boolean;
	models?: AiPromptModels;
}>(), { placeholder: 'Ask AI…', ariaLabel: 'AI prompt', rows: 2, canSend: true });
const text = defineModel<string>({ default: '' });
const model = defineModel<string>('model', { default: '' });
const speed = defineModel<string>('speed', { default: '' });
const emit = defineEmits<{ submit: [] }>();
defineSlots<{ tools?(): unknown; actions?(): unknown }>();

const speedsOf = (id: string) => props.models?.speeds?.[id];
const options = computed<AiInputModel[]>(() => (props.models?.options ?? []).filter(id => id !== props.models?.default).map(id => ({ id, label: id, provider: 'Models', features: { speeds: speedsOf(id) } })));
const draft = computed<AiInputDraft>({
	get: () => ({ text: text.value, ...(props.models ? { model: model.value === props.models.default ? 'auto' : model.value, speed: speed.value } : {}) }),
	set: next => {
		text.value = next.text ?? '';
		if (!props.models) return;
		model.value = next.model && next.model !== 'auto' ? next.model : props.models.default;
		speed.value = next.speed ?? '';
	},
});
</script>

<template>
	<DomAiInput v-model="draft" :models="options" :auto-features="{ speeds: models && speedsOf(models.default) }" :resolved-model-label="models?.default" :aria-label="ariaLabel" :placeholder="placeholder" :rows="rows" :max-rows="12" :submit-on-enter="false" :disabled="disabled" :submit-disabled="!canSend" :submitting="busy" @submit="emit('submit')">
		<template #add><span hidden></span></template>
		<template v-if="$slots.tools" #tools><slot name="tools" /></template>
		<template v-if="$slots.actions" #actions><slot name="actions" /></template>
	</DomAiInput>
</template>
