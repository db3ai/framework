<script setup lang="ts">
import { ref } from 'vue';
import type { FlowValue, FlowValueDefinition, FlowValueDefinitions, FlowValues } from '@db3.ai/app/flows';

const props = defineProps<{
	definitions: FlowValueDefinitions;
	modelValue: FlowValues;
}>();

const emit = defineEmits<{
	'update:modelValue': [value: FlowValues];
	'validation': [valid: boolean];
}>();

const jsonText = ref<Record<string, string>>(initialJsonText());
const errors = ref<Record<string, string>>({});

/**
 * Updates one primitive run input from its native form control.
 *
 * @param name - Public flow input name.
 * @param schema - Serialized input schema.
 * @param event - Native form event containing the next value.
 */
function updatePrimitive(name: string, schema: FlowValueDefinition, event: Event): void {
	const target = event.target as HTMLInputElement;
	let value: FlowValue;

	if (schema.type === 'boolean') {
		value = target.checked;
	} else if (schema.type === 'number') {
		value = Number(target.value);
	} else {
		value = target.value;
	}

	emitValue(name, value);
}

/**
 * Parses and updates one structured JSON run input while preserving invalid text.
 *
 * @param name - Public flow input name.
 * @param schema - Serialized input schema.
 * @param event - Native textarea event containing JSON source.
 */
function updateJson(name: string, schema: FlowValueDefinition, event: Event): void {
	const source = (event.target as HTMLTextAreaElement).value;

	jsonText.value = {
		...jsonText.value,
		[name]: source,
	};

	try {
		const parsed = JSON.parse(source) as FlowValue;

		if (schema.type === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
			throw new Error('Expected a JSON object.');
		}

		if (schema.type === 'array' && !Array.isArray(parsed)) {
			throw new Error('Expected a JSON array.');
		}

		setError(name, null);
		emitValue(name, parsed);
	} catch (caught) {
		setError(name, caught instanceof Error ? caught.message : String(caught));
	}
}

/**
 * Emits a complete updated run-input object.
 *
 * @param name - Public flow input name to replace.
 * @param value - Parsed JSON-safe value.
 */
function emitValue(name: string, value: FlowValue): void {
	emit('update:modelValue', {
		...props.modelValue,
		[name]: value,
	});
}

/**
 * Stores one field validation error and publishes whole-form validity.
 *
 * @param name - Public flow input name.
 * @param message - Error message, or null when valid.
 */
function setError(name: string, message: string | null): void {
	const nextErrors = { ...errors.value };

	if (message) {
		nextErrors[name] = message;
	} else {
		delete nextErrors[name];
	}

	errors.value = nextErrors;
	emit('validation', Object.keys(nextErrors).length === 0);
}

/**
 * Returns whether a schema requires a structured JSON textarea.
 *
 * @param schema - Public flow input schema.
 * @returns True for object, array, and unrestricted JSON values.
 */
function isJsonEditor(schema: FlowValueDefinition): boolean {
	return schema.type === 'object' || schema.type === 'array' || schema.type === 'json';
}

/**
 * Returns whether renderer hints request a multiline string editor.
 *
 * @param schema - Public flow input schema.
 * @returns True for textarea-like component hints or an explicit row count.
 */
function isMultilineEditor(schema: FlowValueDefinition): boolean {
	return schema.type === 'string' && (
		Boolean(schema.editor?.rows)
		|| schema.editor?.component === 'DomTextareaInput'
	);
}

/**
 * Builds stable initial textarea source from parsed model values.
 *
 * @returns JSON text keyed by structured public input name.
 */
function initialJsonText(): Record<string, string> {
	return Object.fromEntries(Object.entries(props.definitions).flatMap(([name, schema]) => (
		isStructuredSchema(schema)
			? [[name, JSON.stringify(props.modelValue[name], null, 2) ?? 'null']]
			: []
	)));
}

/**
 * Checks a schema type without relying on component setup state.
 *
 * @param schema - Public flow input schema.
 * @returns True when the value is edited as JSON text.
 */
function isStructuredSchema(schema: FlowValueDefinition): boolean {
	return schema.type === 'object' || schema.type === 'array' || schema.type === 'json';
}
</script>

<template>
	<div class="flow-run-input-form">
		<label
			v-for="(schema, name) in definitions"
			:key="name"
			class="flow-field"
			:data-editor-component="schema.editor?.component"
		>
			<span>{{ schema.editor?.label || name }}</span>
			<input
				v-if="schema.type === 'boolean'"
				type="checkbox"
				:checked="Boolean(modelValue[String(name)])"
				@change="updatePrimitive(String(name), schema, $event)"
			>
			<textarea
				v-else-if="isJsonEditor(schema)"
				:value="jsonText[String(name)]"
				:placeholder="schema.editor?.placeholder"
				:rows="schema.editor?.rows || 7"
				:aria-invalid="Boolean(errors[String(name)])"
				@input="updateJson(String(name), schema, $event)"
			/>
			<textarea
				v-else-if="isMultilineEditor(schema)"
				:value="String(modelValue[String(name)] ?? '')"
				:placeholder="schema.editor?.placeholder"
				:rows="schema.editor?.rows || 4"
				@input="updatePrimitive(String(name), schema, $event)"
			/>
			<input
				v-else
				:type="schema.type === 'number' ? 'number' : 'text'"
				:value="String(modelValue[String(name)] ?? '')"
				:placeholder="schema.editor?.placeholder"
				@input="updatePrimitive(String(name), schema, $event)"
			>
			<small v-if="errors[String(name)]" class="flow-field-error">{{ errors[String(name)] }}</small>
			<small v-else-if="schema.description">{{ schema.description }}</small>
		</label>
	</div>
</template>
