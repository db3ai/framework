import { isUlid } from '@db3.ai/pure/ulid';

import { FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE } from './blocks';
import type { CompiledFlowBlock, CompiledFlowDefinition, FlowBlockDefinition, FlowBlockInstance, FlowConnection, FlowDefinition, FlowExecutionDefinition, FlowValueDefinition, FlowValueDefinitions } from './contracts';
import { FlowBlockRegistry } from './FlowBlockRegistry';
import { FlowDefinitionError, type FlowDefinitionIssue } from './FlowDefinitionError';
import { matchesDefinition, validateFlowValues } from './FlowValueValidator';

const FLOW_VALUE_TYPES = new Set([
	'string',
	'number',
	'boolean',
	'object',
	'array',
	'json',
]);

/**
 * Validates serialized flow graphs and produces deterministic sequential plans.
 */
export class FlowCompiler {
	/**
	 * Creates a compiler backed by the executable block registry.
	 *
	 * @param blocks - Registered block types available to definitions.
	 */
	constructor(private readonly blocks: FlowBlockRegistry) {}

	/**
	 * Validates and compiles one source definition into execution order.
	 *
	 * The initial compiler deliberately accepts only one connected sequential path.
	 * Multiple port connections may exist between adjacent blocks, but branching,
	 * merging, and cycles are rejected until their runtime semantics are explicit.
	 *
	 * @param definition - Parsed flow definition or durable execution snapshot.
	 * @returns Validated sequential execution plan.
	 */
	compile(definition: FlowDefinition | FlowExecutionDefinition): CompiledFlowDefinition {
		const issues: FlowDefinitionIssue[] = [];
		const executionDefinition = asExecutionDefinition(definition);
		const resolvedBlocks = this.#resolveBlocks(executionDefinition, issues);

		this.#validateDefinitionShape(executionDefinition, issues);

		if (!Array.isArray(executionDefinition.blocks) || !Array.isArray(executionDefinition.connections)) {
			throw new FlowDefinitionError(issues);
		}

		const instances = new Map<string, FlowBlockInstance>();
		const connections = new Map<string, FlowConnection>();

		for (const [index, instance] of executionDefinition.blocks.entries()) {
			this.#validateBlockInstance(instance, index, instances, resolvedBlocks, issues);
			instances.set(instance.id, instance);
		}

		for (const [index, connection] of executionDefinition.connections.entries()) {
			this.#validateConnection(connection, index, connections, instances, issues);
			connections.set(connection.id, connection);
		}

		const incomingByBlock = mapConnections(executionDefinition.blocks, executionDefinition.connections, 'targetBlockId');
		const outgoingByBlock = mapConnections(executionDefinition.blocks, executionDefinition.connections, 'sourceBlockId');
		const predecessors = relatedBlocks(executionDefinition.blocks, incomingByBlock, 'sourceBlockId');
		const successors = relatedBlocks(executionDefinition.blocks, outgoingByBlock, 'targetBlockId');

		for (const instance of executionDefinition.blocks) {
			if ((predecessors.get(instance.id)?.size ?? 0) > 1) {
				issues.push({
					path: `blocks.${instance.id}`,
					message: 'Merging multiple predecessor blocks is not supported by the sequential runtime.',
				});
			}

			if ((successors.get(instance.id)?.size ?? 0) > 1) {
				issues.push({
					path: `blocks.${instance.id}`,
					message: 'Branching to multiple successor blocks is not supported by the sequential runtime.',
				});
			}
		}

		const roots = executionDefinition.blocks.filter(instance => (predecessors.get(instance.id)?.size ?? 0) === 0);
		const terminals = executionDefinition.blocks.filter(instance => (successors.get(instance.id)?.size ?? 0) === 0);

		if (roots.length !== 1) {
			issues.push({
				path: 'blocks',
				message: `A sequential flow requires exactly one root block; found ${roots.length}.`,
			});
		}

		if (terminals.length !== 1) {
			issues.push({
				path: 'blocks',
				message: `A sequential flow requires exactly one terminal block; found ${terminals.length}.`,
			});
		}

		for (const instance of executionDefinition.blocks) {
			if (instance.type === FLOW_INPUT_BLOCK_TYPE && roots[0]?.id !== instance.id) {
				issues.push({
					path: `blocks.${instance.id}`,
					message: 'The flow input boundary must be the root block.',
				});
			}

			if (instance.type === FLOW_OUTPUT_BLOCK_TYPE && terminals[0]?.id !== instance.id) {
				issues.push({
					path: `blocks.${instance.id}`,
					message: 'The flow output boundary must be the terminal block.',
				});
			}
		}

		for (const instance of executionDefinition.blocks) {
			this.#validateBlockConnections(
				instance,
				incomingByBlock.get(instance.id) ?? [],
				outgoingByBlock.get(instance.id) ?? [],
				roots[0]?.id === instance.id,
				terminals[0]?.id === instance.id,
				executionDefinition,
				resolvedBlocks,
				issues,
			);
		}

		const orderedInstances = roots.length === 1
			? orderSequentialBlocks(roots[0], instances, successors)
			: [];

		if (orderedInstances.length !== executionDefinition.blocks.length) {
			issues.push({
				path: 'connections',
				message: 'Every block must belong to one connected acyclic execution path.',
			});
		}

		if (issues.length > 0) {
			throw new FlowDefinitionError(issues);
		}

		const compiledBlocks = orderedInstances.map<CompiledFlowBlock>((instance, sequence) => ({
			sequence,
			instance,
			block: requiredResolvedBlock(resolvedBlocks, instance),
			incoming: incomingByBlock.get(instance.id) ?? [],
			outgoing: outgoingByBlock.get(instance.id) ?? [],
		}));

		return {
			definition: executionDefinition,
			blocks: compiledBlocks,
			root: compiledBlocks[0],
			terminal: compiledBlocks[compiledBlocks.length - 1],
		};
	}

	/**
	 * Resolves registered block definitions with execution-snapshot overrides.
	 *
	 * @param definition - Definition whose block occurrences require contracts.
	 * @param issues - Mutable issue collection populated for unknown block types.
	 * @returns Effective block definitions keyed by occurrence ULID.
	 */
	#resolveBlocks(
		definition: FlowExecutionDefinition,
		issues: FlowDefinitionIssue[],
	): Map<string, FlowBlockDefinition> {
		const result = new Map<string, FlowBlockDefinition>();

		for (const instance of definition.blocks ?? []) {
			const registered = this.blocks.get(instance.type);

			if (!registered) {
				issues.push({
					path: `blocks.${instance.id}.type`,
					message: `Block type "${instance.type}" is not registered.`,
				});
				continue;
			}

			const resolved = definition.resolvedBlocks[instance.id];

			result.set(instance.id, resolved
				? {
					...registered,
					inputs: resolved.inputs,
					outputs: resolved.outputs,
				}
				: registered);
		}

		return result;
	}

	/**
	 * Validates top-level definition fields before graph traversal.
	 *
	 * @param definition - Source definition to inspect.
	 * @param issues - Mutable issue collection populated by validation.
	 */
	#validateDefinitionShape(definition: FlowDefinition, issues: FlowDefinitionIssue[]): void {
		if (!definition || typeof definition !== 'object') {
			issues.push({ path: '$', message: 'Flow definition must be an object.' });
			return;
		}

		if (definition.schemaVersion !== 1) {
			issues.push({ path: 'schemaVersion', message: 'Only flow schema version 1 is supported.' });
		}

		if (!isUlid(definition.id)) {
			issues.push({ path: 'id', message: 'Flow id must be a valid ULID.' });
		}

		if (!definition.name?.trim()) {
			issues.push({ path: 'name', message: 'Flow name is required.' });
		}

		validateValueDefinitions(definition.inputs, 'inputs', issues);
		validateValueDefinitions(definition.outputs, 'outputs', issues);

		if (!Array.isArray(definition.blocks) || definition.blocks.length === 0) {
			issues.push({ path: 'blocks', message: 'At least one block is required.' });
		}

		if (!Array.isArray(definition.connections)) {
			issues.push({ path: 'connections', message: 'Connections must be an array.' });
		}
	}

	/**
	 * Validates one configured block occurrence and its registered type.
	 *
	 * @param instance - Configured block occurrence.
	 * @param index - Block position in the serialized definition array.
	 * @param instances - Previously visited block occurrences keyed by ULID.
	 * @param issues - Mutable issue collection populated by validation.
	 */
	#validateBlockInstance(
		instance: FlowBlockInstance,
		index: number,
		instances: Map<string, FlowBlockInstance>,
		resolvedBlocks: Map<string, FlowBlockDefinition>,
		issues: FlowDefinitionIssue[],
	): void {
		const path = `blocks[${index}]`;

		if (!instance || typeof instance !== 'object') {
			issues.push({ path, message: 'Block must be an object.' });
			return;
		}

		if (!isUlid(instance.id)) {
			issues.push({ path: `${path}.id`, message: 'Block id must be a valid ULID.' });
		} else if (instances.has(instance.id)) {
			issues.push({ path: `${path}.id`, message: `Duplicate block id "${instance.id}".` });
		}

		const block = resolvedBlocks.get(instance.id);

		if (!block) {
			issues.push({ path: `${path}.type`, message: `Block type "${instance.type}" is not registered.` });
			return;
		}

		if ((block.kind ?? 'function') === 'flow') {
			if (!instance.flowId || !isUlid(instance.flowId)) {
				issues.push({ path: `${path}.flowId`, message: 'Flow-backed blocks require a valid nested flow ULID.' });
			}
		} else if (instance.flowId !== undefined) {
			issues.push({ path: `${path}.flowId`, message: 'Only flow-backed block types may reference a nested flow.' });
		}

		if (!instance.position || !Number.isFinite(instance.position.x) || !Number.isFinite(instance.position.y)) {
			issues.push({ path: `${path}.position`, message: 'Block position requires finite x and y coordinates.' });
		}

		validateValueDefinitions(block.inputs, `${path}.type.inputs`, issues);
		validateValueDefinitions(block.outputs, `${path}.type.outputs`, issues);
		validateValueDefinitions(block.config ?? {}, `${path}.type.config`, issues);

		for (const key of Object.keys(instance.config ?? {})) {
			if (!(key in (block.config ?? {}))) {
				issues.push({ path: `${path}.config.${key}`, message: 'Configuration field is not declared by the block type.' });
			}
		}

		try {
			validateFlowValues(instance.config ?? {}, block.config ?? {}, `${path}.config`);
		} catch (error) {
			issues.push({
				path: `${path}.config`,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Validates one graph connection and its referenced block ids.
	 *
	 * @param connection - Serialized named-port connection.
	 * @param index - Connection position in the definition array.
	 * @param connections - Previously visited connections keyed by ULID.
	 * @param instances - Available block occurrences keyed by ULID.
	 * @param issues - Mutable issue collection populated by validation.
	 */
	#validateConnection(
		connection: FlowConnection,
		index: number,
		connections: Map<string, FlowConnection>,
		instances: Map<string, FlowBlockInstance>,
		issues: FlowDefinitionIssue[],
	): void {
		const path = `connections[${index}]`;

		if (!connection || typeof connection !== 'object') {
			issues.push({ path, message: 'Connection must be an object.' });
			return;
		}

		if (!isUlid(connection.id)) {
			issues.push({ path: `${path}.id`, message: 'Connection id must be a valid ULID.' });
		} else if (connections.has(connection.id)) {
			issues.push({ path: `${path}.id`, message: `Duplicate connection id "${connection.id}".` });
		}

		if (!instances.has(connection.sourceBlockId)) {
			issues.push({ path: `${path}.sourceBlockId`, message: 'Source block does not exist.' });
		}

		if (!instances.has(connection.targetBlockId)) {
			issues.push({ path: `${path}.targetBlockId`, message: 'Target block does not exist.' });
		}

		if (connection.sourceBlockId === connection.targetBlockId) {
			issues.push({ path, message: 'A block cannot connect to itself.' });
		}
	}

	/**
	 * Validates port mappings and public input/output compatibility for one block.
	 *
	 * @param instance - Block occurrence being validated.
	 * @param incoming - Connections entering the block.
	 * @param outgoing - Connections leaving the block.
	 * @param isRoot - Whether this block consumes public flow input.
	 * @param isTerminal - Whether this block emits public flow output.
	 * @param definition - Complete source graph.
	 * @param issues - Mutable issue collection populated by validation.
	 */
	#validateBlockConnections(
		instance: FlowBlockInstance,
		incoming: FlowConnection[],
		outgoing: FlowConnection[],
		isRoot: boolean,
		isTerminal: boolean,
		definition: FlowDefinition,
		resolvedBlocks: Map<string, FlowBlockDefinition>,
		issues: FlowDefinitionIssue[],
	): void {
		const block = resolvedBlocks.get(instance.id);

		if (!block) return;

		const connectedInputs = new Set<string>();

		for (const connection of incoming) {
			const sourceInstance = definition.blocks.find(candidate => candidate.id === connection.sourceBlockId);
			const sourceBlock = sourceInstance ? resolvedBlocks.get(sourceInstance.id) : null;
			const sourcePort = sourceBlock?.outputs[connection.sourcePort];
			const targetPort = block.inputs[connection.targetPort];

			if (!sourcePort) {
				issues.push({
					path: `connections.${connection.id}.sourcePort`,
					message: `Output port "${connection.sourcePort}" does not exist on block type "${sourceInstance?.type ?? 'unknown'}".`,
				});
			}

			if (!targetPort) {
				issues.push({
					path: `connections.${connection.id}.targetPort`,
					message: `Input port "${connection.targetPort}" does not exist on block type "${instance.type}".`,
				});
			}

			if (sourcePort && targetPort && !compatibleDefinitions(sourcePort, targetPort)) {
				issues.push({
					path: `connections.${connection.id}`,
					message: `Cannot connect ${sourcePort.type} output to ${targetPort.type} input.`,
				});
			}

			if (connectedInputs.has(connection.targetPort)) {
				issues.push({
					path: `connections.${connection.id}.targetPort`,
					message: `Input port "${connection.targetPort}" already has a connection.`,
				});
			}

			connectedInputs.add(connection.targetPort);
		}

		if (isRoot) {
			validatePublicBoundary(definition.inputs, block.inputs, 'inputs', instance.id, issues);
		} else {
			for (const [name, port] of Object.entries(block.inputs)) {
				if (port.required && !connectedInputs.has(name)) {
					issues.push({
						path: `blocks.${instance.id}.inputs.${name}`,
						message: 'Required input port is not connected.',
					});
				}
			}
		}

		for (const connection of outgoing) {
			if (!block.outputs[connection.sourcePort]) {
				issues.push({
					path: `connections.${connection.id}.sourcePort`,
					message: `Output port "${connection.sourcePort}" does not exist on block type "${instance.type}".`,
				});
			}
		}

		if (isTerminal) {
			validatePublicBoundary(definition.outputs, block.outputs, 'outputs', instance.id, issues);
		}
	}
}

/**
 * Validates a named value schema object.
 *
 * @param definitions - Named value schemas to validate.
 * @param path - Definition path used in issue messages.
 * @param issues - Mutable issue collection populated by validation.
 */
function validateValueDefinitions(
	definitions: FlowValueDefinitions,
	path: string,
	issues: FlowDefinitionIssue[],
): void {
	if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
		issues.push({ path, message: 'Value definitions must be an object.' });
		return;
	}

	for (const [name, definition] of Object.entries(definitions)) {
		if (!name.trim()) {
			issues.push({ path, message: 'Value names cannot be empty.' });
		}

		if (!definition || typeof definition !== 'object' || !FLOW_VALUE_TYPES.has(definition.type)) {
			issues.push({ path: `${path}.${name}.type`, message: 'Unsupported flow value type.' });
			continue;
		}

		if (definition.default !== undefined && !matchesDefinition(definition.default, definition)) {
			issues.push({ path: `${path}.${name}.default`, message: 'Default value does not match its declared type.' });
		}
	}
}

/**
 * Maps incoming or outgoing connections by block id.
 *
 * @param blocks - Block occurrences used to seed empty connection lists.
 * @param connections - Serialized graph connections.
 * @param key - Connection endpoint used as the map key.
 * @returns Connections grouped by block occurrence ULID.
 */
function mapConnections(
	blocks: FlowBlockInstance[],
	connections: FlowConnection[],
	key: 'sourceBlockId' | 'targetBlockId',
): Map<string, FlowConnection[]> {
	const result = new Map(blocks.map(block => [block.id, [] as FlowConnection[]]));

	for (const connection of connections) {
		result.get(connection[key])?.push(connection);
	}

	return result;
}

/**
 * Maps unique adjacent block ids for each block in the graph.
 *
 * @param blocks - Block occurrences used to seed empty adjacency sets.
 * @param connections - Connections already grouped by block.
 * @param key - Opposite endpoint used to identify adjacent blocks.
 * @returns Unique related block ids grouped by block occurrence ULID.
 */
function relatedBlocks(
	blocks: FlowBlockInstance[],
	connections: Map<string, FlowConnection[]>,
	key: 'sourceBlockId' | 'targetBlockId',
): Map<string, Set<string>> {
	return new Map(blocks.map(block => [
		block.id,
		new Set((connections.get(block.id) ?? []).map(connection => connection[key])),
	]));
}

/**
 * Follows one sequential successor chain into deterministic order.
 *
 * @param root - Root block occurrence.
 * @param instances - All block occurrences keyed by ULID.
 * @param successors - Unique successor ids grouped by block ULID.
 * @returns Reachable block occurrences in execution order.
 */
function orderSequentialBlocks(
	root: FlowBlockInstance,
	instances: Map<string, FlowBlockInstance>,
	successors: Map<string, Set<string>>,
): FlowBlockInstance[] {
	const ordered: FlowBlockInstance[] = [];
	const visited = new Set<string>();
	let current: FlowBlockInstance | undefined = root;

	while (current && !visited.has(current.id)) {
		ordered.push(current);
		visited.add(current.id);

		const nextId: string | undefined = [...(successors.get(current.id) ?? [])][0];
		current = nextId ? instances.get(nextId) : undefined;
	}

	return ordered;
}

/**
 * Checks whether a source value type can supply a target value type.
 *
 * @param source - Source output schema.
 * @param target - Target input schema.
 * @returns True when the port types are compatible.
 */
function compatibleDefinitions(source: FlowValueDefinition, target: FlowValueDefinition): boolean {
	return source.type === 'json' || target.type === 'json' || source.type === target.type;
}

/**
 * Adds empty runtime resolution maps to a source definition for direct compiler use.
 *
 * The application flow service normally supplies populated maps. Keeping direct
 * compilation available is useful for static block tests and developer tooling.
 *
 * @param definition - Source definition or previously resolved execution snapshot.
 * @returns Definition with runtime resolution maps.
 */
function asExecutionDefinition(definition: FlowDefinition | FlowExecutionDefinition): FlowExecutionDefinition {
	if ('resolvedBlocks' in definition && 'nestedDefinitions' in definition) {
		return definition;
	}

	return {
		...definition,
		resolvedBlocks: {},
		nestedDefinitions: {},
	};
}

/**
 * Returns the effective definition for one compiled occurrence.
 *
 * @param blocks - Resolved occurrence definitions.
 * @param instance - Block occurrence being compiled.
 * @returns Registered or dynamically resolved block definition.
 */
function requiredResolvedBlock(
	blocks: Map<string, FlowBlockDefinition>,
	instance: FlowBlockInstance,
): FlowBlockDefinition {
	const block = blocks.get(instance.id);

	if (!block) {
		throw new Error(`Flow block type "${instance.type}" is not registered.`);
	}

	return block;
}

/**
 * Validates root input or terminal output ports against the public flow contract.
 *
 * @param publicDefinitions - Public flow boundary schemas.
 * @param blockDefinitions - Root or terminal block port schemas.
 * @param boundary - Public boundary being validated.
 * @param blockId - Boundary block occurrence ULID.
 * @param issues - Mutable issue collection populated by validation.
 */
function validatePublicBoundary(
	publicDefinitions: FlowValueDefinitions,
	blockDefinitions: FlowValueDefinitions,
	boundary: 'inputs' | 'outputs',
	blockId: string,
	issues: FlowDefinitionIssue[],
): void {
	for (const [name, definition] of Object.entries(publicDefinitions)) {
		const blockDefinition = blockDefinitions[name];

		if (!blockDefinition) {
			issues.push({
				path: `blocks.${blockId}.${boundary}.${name}`,
				message: `The ${boundary === 'inputs' ? 'root' : 'terminal'} block must expose public ${boundary.slice(0, -1)} "${name}".`,
			});
			continue;
		}

		if (!compatibleDefinitions(definition, blockDefinition)) {
			issues.push({
				path: `blocks.${blockId}.${boundary}.${name}`,
				message: `Public ${definition.type} value is incompatible with block ${blockDefinition.type} port.`,
			});
		}
	}
}
