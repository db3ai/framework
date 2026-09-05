import type { FlowBlockDefinition, FlowBlockMetadata } from './contracts';

/**
 * Runtime registry resolving serialized block type names into executable functions.
 */
export class FlowBlockRegistry {
	readonly #blocks = new Map<string, FlowBlockDefinition>();

	/**
	 * Creates a registry and optionally registers initial block types.
	 *
	 * @param blocks - Block definitions available to the runtime.
	 */
	constructor(blocks: FlowBlockDefinition[] = []) {
		for (const block of blocks) {
			this.register(block);
		}
	}

	/**
	 * Registers one executable block type.
	 *
	 * @param block - Block definition to register.
	 */
	register(block: FlowBlockDefinition): void {
		const type = block.type.trim();

		if (!type) {
			throw new Error('Flow block type is required.');
		}

		if (this.#blocks.has(type)) {
			throw new Error(`Flow block type "${type}" is already registered.`);
		}

		if ((block.kind ?? 'function') === 'function' && typeof block.run !== 'function') {
			throw new Error(`Function flow block type "${type}" requires a run function.`);
		}

		this.#blocks.set(type, block);
	}

	/**
	 * Resolves one registered block type.
	 *
	 * @param type - Serialized block type name.
	 * @returns Registered block definition or null.
	 */
	get(type: string): FlowBlockDefinition | null {
		return this.#blocks.get(type) ?? null;
	}

	/**
	 * Resolves one block type or throws a developer-facing error.
	 *
	 * @param type - Serialized block type name.
	 * @returns Registered block definition.
	 */
	require(type: string): FlowBlockDefinition {
		const block = this.get(type);

		if (!block) {
			throw new Error(`Flow block type "${type}" is not registered.`);
		}

		return block;
	}

	/**
	 * Returns serializable metadata for block palettes and inspectors.
	 *
	 * @returns Registered block metadata ordered by display name.
	 */
	metadata(): FlowBlockMetadata[] {
		return [...this.#blocks.values()]
			.map(({ run: _run, ...metadata }) => metadata)
			.sort((a, b) => a.name.localeCompare(b.name));
	}
}
