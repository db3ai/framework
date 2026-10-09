import type { FlowBlockInstance, FlowBlockMetadata, FlowConnection, FlowDefinition, FlowValueDefinition, FlowValueDefinitions } from '@db3.ai/app/flows';
import { ulid } from '@db3.ai/pure/ulid';

/** Result of inserting one registered block into an existing connection. */
export interface InsertBlockResult {
	/** Complete source definition containing the inserted block and replacement connections. */
	definition: FlowDefinition;
	/** Stable occurrence ULID assigned to the inserted block. */
	blockId: string;
}

interface InsertionPorts {
	input: string;
	output: string;
}

const INSERTION_SPACING = 300;

/**
 * Lists function blocks that can preserve the value contract of a connection.
 *
 * Flow-backed blocks are excluded because inserting one also requires choosing a
 * nested definition. They remain available through normal drag-and-configure.
 *
 * @param definition - Current source graph.
 * @param connection - Selected connection to inspect.
 * @param blocks - Registered designer-safe block metadata.
 * @returns Blocks with compatible input and output ports.
 */
export function compatibleInsertionBlocks(
	definition: FlowDefinition,
	connection: FlowConnection,
	blocks: FlowBlockMetadata[],
): FlowBlockMetadata[] {
	return blocks.filter(block => (
		(block.kind ?? 'function') === 'function'
		&& block.insertable === true
		&& insertionPorts(definition, connection, block, blocks) !== null
	));
}

/**
 * Inserts a configured block occurrence into one serialized connection.
 *
 * The selected connection is replaced in place by source-to-block and
 * block-to-target connections using compatible named ports.
 *
 * @param definition - Current source graph.
 * @param connectionId - Connection ULID to replace.
 * @param block - Registered block metadata to insert.
 * @param blocks - Complete block catalog used to resolve endpoint schemas.
 * @returns Updated source definition and inserted block ULID.
 */
export function insertBlockOnConnection(
	definition: FlowDefinition,
	connectionId: string,
	block: FlowBlockMetadata,
	blocks: FlowBlockMetadata[],
): InsertBlockResult {
	const connectionIndex = definition.connections.findIndex(connection => connection.id === connectionId);
	const connection = definition.connections[connectionIndex];

	if (!connection) {
		throw new Error(`Flow connection "${connectionId}" was not found.`);
	}

	const ports = insertionPorts(definition, connection, block, blocks);

	if (!ports) {
		throw new Error(`Block type "${block.type}" is not compatible with the selected connection.`);
	}

	const blockId = ulid();
	const nextDefinition = structuredClone(definition);
	const source = requiredInstance(nextDefinition, connection.sourceBlockId);
	const target = requiredInstance(nextDefinition, connection.targetBlockId);
	const requiredTargetX = source.position.x + (INSERTION_SPACING * 2);
	const downstreamShift = target.position.x > source.position.x
		? Math.max(0, requiredTargetX - target.position.x)
		: 0;

	if (downstreamShift > 0) {
		const downstream = downstreamBlockIds(nextDefinition, target.id);

		for (const instance of nextDefinition.blocks) {
			if (downstream.has(instance.id)) {
				instance.position.x += downstreamShift;
			}
		}
	}

	const config = defaultConfig(block.config ?? {});
	const instance: FlowBlockInstance = {
		id: blockId,
		type: block.type,
		name: block.name,
		...(Object.keys(config).length > 0 ? { config } : {}),
		position: {
			x: target.position.x > source.position.x
				? Math.round(source.position.x + INSERTION_SPACING)
				: Math.round((source.position.x + target.position.x) / 2),
			y: Math.round((source.position.y + target.position.y) / 2),
		},
	};

	nextDefinition.blocks.push(instance);
	nextDefinition.connections.splice(connectionIndex, 1,
		{
			id: ulid(),
			sourceBlockId: connection.sourceBlockId,
			sourcePort: connection.sourcePort,
			targetBlockId: blockId,
			targetPort: ports.input,
		},
		{
			id: ulid(),
			sourceBlockId: blockId,
			sourcePort: ports.output,
			targetBlockId: connection.targetBlockId,
			targetPort: connection.targetPort,
		},
	);

	return {
		definition: nextDefinition,
		blockId,
	};
}

/**
 * Finds the selected target block and all graph descendants that should move
 * together when an inserted node needs horizontal space.
 *
 * @param definition - Current sequential source graph.
 * @param targetBlockId - First downstream block occurrence.
 * @returns Reachable downstream block ids including the target.
 */
function downstreamBlockIds(definition: FlowDefinition, targetBlockId: string): Set<string> {
	const result = new Set<string>();
	const pending = [targetBlockId];

	while (pending.length > 0) {
		const blockId = pending.shift();

		if (!blockId || result.has(blockId)) continue;

		result.add(blockId);

		for (const connection of definition.connections) {
			if (connection.sourceBlockId === blockId) {
				pending.push(connection.targetBlockId);
			}
		}
	}

	return result;
}

/**
 * Resolves compatible candidate ports for one connection insertion.
 *
 * @param definition - Current source graph.
 * @param connection - Connection whose contract must be preserved.
 * @param candidate - Candidate registered block.
 * @param blocks - Complete block catalog used to resolve endpoint schemas.
 * @returns Selected input/output names, or null when no pair is compatible.
 */
function insertionPorts(
	definition: FlowDefinition,
	connection: FlowConnection,
	candidate: FlowBlockMetadata,
	blocks: FlowBlockMetadata[],
): InsertionPorts | null {
	const source = requiredInstance(definition, connection.sourceBlockId);
	const target = requiredInstance(definition, connection.targetBlockId);
	const sourceMetadata = blocks.find(block => block.type === source.type);
	const targetMetadata = blocks.find(block => block.type === target.type);
	const sourceSchema = sourceMetadata?.outputs[connection.sourcePort];
	const targetSchema = targetMetadata?.inputs[connection.targetPort];

	if (!sourceSchema || !targetSchema) return null;

	const input = compatiblePort(candidate.inputs, sourceSchema, connection.sourcePort, 'target');
	const output = compatiblePort(candidate.outputs, targetSchema, connection.targetPort, 'source');

	return input && output ? { input, output } : null;
}

/**
 * Chooses a compatible named port, preferring a name matching the existing edge.
 *
 * @param definitions - Candidate block port definitions.
 * @param boundary - Existing connection boundary schema.
 * @param preferredName - Existing port name to prefer when available.
 * @param direction - Whether the candidate port receives from or emits to the boundary.
 * @returns Compatible named port, or null.
 */
function compatiblePort(
	definitions: FlowValueDefinitions,
	boundary: FlowValueDefinition,
	preferredName: string,
	direction: 'source' | 'target',
): string | null {
	const entries = Object.entries(definitions).sort(([left], [right]) => {
		if (left === preferredName) return -1;
		if (right === preferredName) return 1;
		return left.localeCompare(right);
	});

	for (const [name, definition] of entries) {
		const compatible = direction === 'target'
			? compatibleDefinitions(boundary, definition)
			: compatibleDefinitions(definition, boundary);

		if (compatible) return name;
	}

	return null;
}

/**
 * Checks exact type compatibility for a value-preserving automatic insertion.
 *
 * Manual graph connections retain the compiler's broader JSON wildcard rule,
 * but insertion only offers blocks whose declared boundary type is unchanged.
 *
 * @param source - Emitting value schema.
 * @param target - Receiving value schema.
 * @returns True when values can cross the boundary.
 */
function compatibleDefinitions(source: FlowValueDefinition, target: FlowValueDefinition): boolean {
	return source.type === target.type;
}

/**
 * Builds initial block configuration from serialized schema defaults.
 *
 * @param definitions - Registered block configuration schemas.
 * @returns JSON-safe default configuration values.
 */
function defaultConfig(definitions: FlowValueDefinitions) {
	return Object.fromEntries(Object.entries(definitions).flatMap(([name, definition]) => (
		definition.default === undefined ? [] : [[name, structuredClone(definition.default)]]
	)));
}

/**
 * Resolves a block occurrence required by a serialized connection.
 *
 * @param definition - Current source graph.
 * @param blockId - Referenced block ULID.
 * @returns Referenced block occurrence.
 */
function requiredInstance(definition: FlowDefinition, blockId: string): FlowBlockInstance {
	const instance = definition.blocks.find(block => block.id === blockId);

	if (!instance) {
		throw new Error(`Flow block "${blockId}" was not found.`);
	}

	return instance;
}
