<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FlowBlockInstance, FlowBlockMetadata, FlowConnection, FlowDefinition, FlowDefinitionSummary, FlowValue, FlowValueDefinition, FlowValueDefinitions } from '@db3.ai/app/flows';
import { FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE } from '@db3.ai/app/flows/blocks';
import { BetweenHorizontalEnd, Plus, Trash2 } from '@lucide/vue';

import type { FlowRunDetailsRecord, FlowStepRunRecord } from './contracts';
import { metadataForInstance } from './flowMetadata';
import { compatibleInsertionBlocks } from './graphOperations';

const props = defineProps<{
	definition: FlowDefinition;
	block: FlowBlockInstance | null;
	connection: FlowConnection | null;
	metadata: FlowBlockMetadata | null;
	blocks: FlowBlockMetadata[];
	flows: FlowDefinitionSummary[];
	runDetails: FlowRunDetailsRecord | null;
}>();

const emit = defineEmits<{
	'update:block': [block: FlowBlockInstance];
	'update:flow': [definition: FlowDefinition];
	'delete:block': [blockId: string];
	'insert:block': [connectionId: string, type: string];
	'delete:connection': [connectionId: string];
}>();

const insertionType = ref('');
const configJsonText = ref<Record<string, string>>({});
const configErrors = ref<Record<string, string>>({});

const step = computed<FlowStepRunRecord | null>(() => {
	if (!props.block) return null;

	return props.runDetails?.steps.find(candidate => candidate.blockId === props.block?.id) ?? null;
});
const logs = computed(() => {
	if (!step.value) return [];

	return props.runDetails?.events.filter(event => event.stepRun === step.value?.id && event.type === 'step.log') ?? [];
});
const connectionSource = computed(() => props.definition.blocks.find(block => block.id === props.connection?.sourceBlockId) ?? null);
const connectionTarget = computed(() => props.definition.blocks.find(block => block.id === props.connection?.targetBlockId) ?? null);
const sourceMetadata = computed(() => connectionSource.value
	? metadataForInstance(connectionSource.value, props.definition, props.blocks, props.flows)
	: null);
const targetMetadata = computed(() => connectionTarget.value
	? metadataForInstance(connectionTarget.value, props.definition, props.blocks, props.flows)
	: null);
const sourceStep = computed(() => props.runDetails?.steps.find(step => step.blockId === connectionSource.value?.id) ?? null);
const connectionValue = computed(() => {
	if (!props.connection || !sourceStep.value?.output) return undefined;

	return sourceStep.value.output[props.connection.sourcePort];
});
const compatibleBlocks = computed(() => {
	if (!props.connection) return [];

	return compatibleInsertionBlocks(props.definition, props.connection, props.blocks);
});
const boundaryDirection = computed<'inputs' | 'outputs' | null>(() => {
	if (props.block?.type === FLOW_INPUT_BLOCK_TYPE) return 'inputs';
	if (props.block?.type === FLOW_OUTPUT_BLOCK_TYPE) return 'outputs';

	return null;
});
const boundaryDefinitions = computed(() => boundaryDirection.value
	? props.definition[boundaryDirection.value]
	: {});

watch(compatibleBlocks, options => {
	insertionType.value = options.some(block => block.type === insertionType.value)
		? insertionType.value
		: options[0]?.type ?? '';
}, { immediate: true });

watch(() => [props.block?.id, props.block?.config] as const, () => {
	configJsonText.value = Object.fromEntries(Object.entries(props.metadata?.config ?? {}).flatMap(([name, definition]) => (
		isStructuredDefinition(definition)
			? [[name, JSON.stringify(configValue(name, definition), null, 2) ?? 'null']]
			: []
	)));
	configErrors.value = {};
}, { deep: true, immediate: true });

/**
 * Updates the selected block name from a native input event.
 *
 * @param event - Input event containing the next name.
 */
function updateBlockName(event: Event): void {
	if (!props.block) return;

	emit('update:block', {
		...structuredClone(props.block),
		name: (event.target as HTMLInputElement).value,
	});
}

/**
 * Updates the nested definition referenced by a flow-backed block.
 *
 * @param event - Select event containing the child flow ULID.
 */
function updateNestedFlow(event: Event): void {
	if (!props.block) return;

	emit('update:block', {
		...structuredClone(props.block),
		flowId: (event.target as HTMLSelectElement).value || undefined,
	});
}

/**
 * Updates one configured block value from the appropriate native control.
 *
 * @param name - Config field name.
 * @param definition - Config field schema.
 * @param event - Native control event.
 */
function updateConfig(name: string, definition: FlowValueDefinition, event: Event): void {
	if (!props.block) return;

	const target = event.target as HTMLInputElement;
	let value: FlowValue;

	if (definition.type === 'boolean') {
		value = target.checked;
	} else if (definition.type === 'number') {
		value = Number(target.value);
	} else if (isStructuredDefinition(definition)) {
		configJsonText.value = {
			...configJsonText.value,
			[name]: target.value,
		};

		try {
			value = JSON.parse(target.value) as FlowValue;
			configErrors.value = withoutProperty(configErrors.value, name);
		} catch (caught) {
			configErrors.value = {
				...configErrors.value,
				[name]: caught instanceof Error ? caught.message : String(caught),
			};
			return;
		}
	} else {
		value = target.value;
	}

	emit('update:block', {
		...structuredClone(props.block),
		config: {
			...(props.block.config ?? {}),
			[name]: value,
		},
	});
}

/**
 * Returns whether one config field is edited as structured JSON.
 *
 * @param definition - Config field schema.
 * @returns True for object, array, and unrestricted JSON fields.
 */
function isStructuredDefinition(definition: FlowValueDefinition): boolean {
	return definition.type === 'object' || definition.type === 'array' || definition.type === 'json';
}

/**
 * Returns a record without one named property.
 *
 * @param source - Original string record.
 * @param name - Property to omit.
 * @returns New record without the requested property.
 */
function withoutProperty(source: Record<string, string>, name: string): Record<string, string> {
	return Object.fromEntries(Object.entries(source).filter(([key]) => key !== name));
}

/**
 * Updates a top-level flow text property.
 *
 * @param property - Editable flow property.
 * @param event - Native input event.
 */
function updateFlow(property: 'name' | 'description', event: Event): void {
	const definition = structuredClone(props.definition);

	definition[property] = (event.target as HTMLInputElement).value;
	emit('update:flow', definition);
}

/**
 * Adds a stable public input or output key to the selected boundary node.
 */
function addBoundaryPort(): void {
	if (!boundaryDirection.value) return;

	const definition = structuredClone(props.definition);
	const values = definition[boundaryDirection.value];
	const prefix = boundaryDirection.value === 'inputs' ? 'input' : 'output';
	let index = Object.keys(values).length + 1;
	let name = `${prefix}_${index}`;

	while (name in values) {
		index += 1;
		name = `${prefix}_${index}`;
	}

	values[name] = {
		type: 'json',
		required: true,
		editor: {
			label: `${prefix === 'input' ? 'Input' : 'Output'} ${index}`,
		},
	};
	definition[boundaryDirection.value] = values;
	emit('update:flow', definition);
}

/**
 * Updates editable metadata for one public interface port.
 *
 * Stable object keys remain unchanged so parent connections survive label edits.
 *
 * @param name - Stable public contract key.
 * @param property - Schema property being edited.
 * @param event - Native control event containing the next value.
 */
function updateBoundaryPort(
	name: string,
	property: 'label' | 'type' | 'required',
	event: Event,
): void {
	if (!boundaryDirection.value) return;

	const definition = structuredClone(props.definition);
	const values: FlowValueDefinitions = definition[boundaryDirection.value];
	const current = values[name];

	if (!current) return;

	if (property === 'label') {
		current.editor = {
			...current.editor,
			label: (event.target as HTMLInputElement).value,
		};
	} else if (property === 'type') {
		current.type = (event.target as HTMLSelectElement).value as FlowValueDefinition['type'];
	} else {
		current.required = (event.target as HTMLInputElement).checked;
	}

	definition[boundaryDirection.value] = values;
	emit('update:flow', definition);
}

/**
 * Returns the current display value for one config field.
 *
 * @param name - Config field name.
 * @param definition - Config field schema.
 * @returns Configured value or schema default.
 */
function configValue(name: string, definition: FlowValueDefinition): FlowValue | undefined {
	return props.block?.config?.[name] ?? definition.default;
}

/**
 * Formats JSON-safe run data for the inspector.
 *
 * @param value - Persisted flow value.
 * @returns Indented JSON text.
 */
function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2) ?? 'undefined';
}
</script>

<template>
	<aside class="flow-inspector">
		<template v-if="connection && connectionSource && connectionTarget">
			<div class="flow-panel-heading">
				<div>
					<span class="flow-eyebrow">Connection</span>
					<h2>{{ connectionSource.name || sourceMetadata?.name }} to {{ connectionTarget.name || targetMetadata?.name }}</h2>
				</div>
				<button
					class="flow-icon-button is-danger"
					type="button"
					title="Delete connection"
					aria-label="Delete connection"
					@click="emit('delete:connection', connection.id)"
				>
					<Trash2 :size="16" />
				</button>
			</div>

			<dl class="flow-connection-facts">
				<div>
					<dt>From</dt>
					<dd>{{ connection.sourcePort }} <small>{{ sourceMetadata?.outputs[connection.sourcePort]?.type }}</small></dd>
				</div>
				<div>
					<dt>To</dt>
					<dd>{{ connection.targetPort }} <small>{{ targetMetadata?.inputs[connection.targetPort]?.type }}</small></dd>
				</div>
			</dl>

			<section class="flow-inspector__section">
				<h3>Carried value</h3>
				<p v-if="!runDetails" class="flow-empty-copy">Select a run to inspect this connection.</p>
				<p v-else-if="connectionValue === undefined" class="flow-empty-copy">This connection did not carry a value in the selected run.</p>
				<pre v-else class="flow-data-preview">{{ formatJson(connectionValue) }}</pre>
			</section>

			<section class="flow-inspector__section">
				<h3>Insert block</h3>
				<div v-if="compatibleBlocks.length" class="flow-insert-control">
					<select v-model="insertionType" aria-label="Block to insert">
						<option v-for="candidate in compatibleBlocks" :key="candidate.type" :value="candidate.type">
							{{ candidate.name }}
						</option>
					</select>
					<button
						class="flow-icon-button"
						type="button"
						title="Insert block on connection"
						aria-label="Insert block on connection"
						:disabled="!insertionType"
						@click="emit('insert:block', connection.id, insertionType)"
					>
						<Plus :size="16" />
					</button>
				</div>
				<p v-else class="flow-empty-copy">No registered function block preserves this connection contract.</p>
			</section>

			<section class="flow-inspector__section">
				<h3>Source</h3>
				<div class="flow-source-id"><BetweenHorizontalEnd :size="14" />{{ connection.id }}</div>
			</section>
		</template>

		<template v-else-if="block && metadata && boundaryDirection">
			<div class="flow-panel-heading">
				<div>
					<span class="flow-eyebrow">Flow interface</span>
					<h2>{{ boundaryDirection === 'inputs' ? 'Inputs' : 'Outputs' }}</h2>
				</div>
				<button
					class="flow-icon-button"
					type="button"
					:title="boundaryDirection === 'inputs' ? 'Add input' : 'Add output'"
					:aria-label="boundaryDirection === 'inputs' ? 'Add input' : 'Add output'"
					@click="addBoundaryPort"
				>
					<Plus :size="16" />
				</button>
			</div>

			<p class="flow-inspector__description">
				These ports form the public contract shown on every parent subflow block.
			</p>

			<section class="flow-inspector__section">
				<div v-for="(value, name) in boundaryDefinitions" :key="String(name)" class="flow-interface-port">
					<div class="flow-interface-port__key">{{ name }}</div>
					<label class="flow-field">
						<span>Label</span>
						<input :value="value.editor?.label || name" @input="updateBoundaryPort(String(name), 'label', $event)">
					</label>
					<label class="flow-field">
						<span>Type</span>
						<select :value="value.type" @change="updateBoundaryPort(String(name), 'type', $event)">
							<option value="string">String</option>
							<option value="number">Number</option>
							<option value="boolean">Boolean</option>
							<option value="object">Object</option>
							<option value="array">Array</option>
							<option value="json">JSON</option>
						</select>
					</label>
					<label class="flow-toggle-field">
						<input type="checkbox" :checked="Boolean(value.required)" @change="updateBoundaryPort(String(name), 'required', $event)">
						<span>Required</span>
					</label>
				</div>
			</section>
		</template>

		<template v-else-if="block && metadata">
			<div class="flow-panel-heading">
				<div>
					<span class="flow-eyebrow">Block</span>
					<h2>{{ metadata.name }}</h2>
				</div>
				<button
					class="flow-icon-button is-danger"
					type="button"
					title="Delete block"
					aria-label="Delete block"
					@click="emit('delete:block', block.id)"
				>
					<Trash2 :size="16" />
				</button>
			</div>

			<p class="flow-inspector__description">{{ metadata.description }}</p>
			<dl class="flow-block-facts">
				<div><dt>Type</dt><dd>{{ metadata.type }}</dd></div>
				<div><dt>Kind</dt><dd>{{ metadata.kind || 'function' }}</dd></div>
			</dl>

			<label class="flow-field">
				<span>Name</span>
				<input :value="block.name || ''" @input="updateBlockName">
			</label>
			<label v-if="metadata.kind === 'flow'" class="flow-field">
				<span>Nested flow</span>
				<select :value="block.flowId || ''" @change="updateNestedFlow">
					<option value="" disabled>Select a flow</option>
					<option v-for="flow in flows" :key="flow.id" :value="flow.id" :disabled="flow.id === definition.id">
						{{ flow.name }}
					</option>
				</select>
				<small>Double-click the block to open its selected definition.</small>
			</label>

			<section v-if="Object.keys(metadata.config || {}).length" class="flow-inspector__section">
				<h3>Configuration</h3>
				<label v-for="(definition, name) in metadata.config" :key="name" class="flow-field">
					<span>{{ name }}</span>
					<input
						v-if="definition.type === 'boolean'"
						type="checkbox"
						:checked="Boolean(configValue(String(name), definition))"
						@change="updateConfig(String(name), definition, $event)"
					>
					<textarea
						v-else-if="isStructuredDefinition(definition)"
						:value="configJsonText[String(name)]"
						:rows="definition.editor?.rows || 8"
						:aria-invalid="Boolean(configErrors[String(name)])"
						@input="updateConfig(String(name), definition, $event)"
					/>
					<input
						v-else
						:type="definition.type === 'number' ? 'number' : 'text'"
						:value="String(configValue(String(name), definition) ?? '')"
						@input="updateConfig(String(name), definition, $event)"
					>
					<small v-if="configErrors[String(name)]" class="flow-field-error">{{ configErrors[String(name)] }}</small>
					<small v-else-if="definition.description">{{ definition.description }}</small>
				</label>
			</section>

			<section class="flow-inspector__section">
				<h3>Run data</h3>
				<p v-if="!step" class="flow-empty-copy">Select a run to inspect this block.</p>
				<template v-else>
					<div class="flow-step-summary">
						<span class="flow-status" :class="`is-${step.status}`">{{ step.status }}</span>
						<span>Attempt {{ step.attempt }}</span>
					</div>

					<details open>
						<summary>Input</summary>
						<pre>{{ formatJson(step.input) }}</pre>
					</details>
					<details open>
						<summary>Output</summary>
						<pre>{{ formatJson(step.output) }}</pre>
					</details>
					<details v-if="step.error" open>
						<summary>Error</summary>
						<pre>{{ formatJson(step.error) }}</pre>
					</details>
					<details v-if="logs.length" open>
						<summary>Logs ({{ logs.length }})</summary>
						<div v-for="event in logs" :key="event.id" class="flow-log-entry">
							<strong>{{ event.level }}</strong>
							<span>{{ event.message }}</span>
							<pre v-if="event.data !== null">{{ formatJson(event.data) }}</pre>
						</div>
					</details>
				</template>
			</section>
		</template>

		<template v-else>
			<div class="flow-panel-heading">
				<div>
					<span class="flow-eyebrow">Flow</span>
					<h2>Definition</h2>
				</div>
			</div>

			<label class="flow-field">
				<span>Name</span>
				<input :value="definition.name" @input="updateFlow('name', $event)">
			</label>
			<label class="flow-field">
				<span>Description</span>
				<textarea :value="definition.description || ''" rows="4" @input="updateFlow('description', $event)" />
			</label>

			<section class="flow-inspector__section">
				<h3>Source</h3>
				<dl class="flow-definition-facts">
					<div><dt>ULID</dt><dd>{{ definition.id }}</dd></div>
					<div><dt>Blocks</dt><dd>{{ definition.blocks.length }}</dd></div>
					<div><dt>Connections</dt><dd>{{ definition.connections.length }}</dd></div>
				</dl>
			</section>
		</template>
	</aside>
</template>
