import type { Knex } from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Serializable } from '..';
import { SerializationError, SerializationRegistryError, Serializer } from '..';
import { App, app, clearActiveApp } from '../../server';

interface ExampleState {
	name: string;
	count: number;
	options: {
		enabled: boolean;
	};
}

/**
 * Serializable fixture that derives private state through its constructor.
 */
class ExampleSerializable implements Serializable<ExampleState> {
	readonly #state: ExampleState;
	readonly #label: string;

	/**
	 * Creates one validated serializable test value.
	 *
	 * @param state - Complete constructor state.
	 */
	constructor(state: ExampleState) {
		if (
			!state
			|| typeof state.name !== 'string'
			|| !Number.isSafeInteger(state.count)
			|| typeof state.options?.enabled !== 'boolean'
		) {
			throw new TypeError('ExampleSerializable requires valid state.');
		}

		this.#state = state;
		this.#label = `${state.name}:${state.count}`;
	}

	/**
	 * Returns complete state accepted by the constructor.
	 *
	 * @returns Canonical constructor state.
	 */
	toJSON(): ExampleState {
		return this.#state;
	}

	/**
	 * Returns a value derived through the constructor and stored privately.
	 *
	 * @returns Derived private label.
	 */
	label(): string {
		return this.#label;
	}
}

/**
 * Alternate fixture used to test ambiguous registry entries.
 */
class OtherSerializable implements Serializable<{ value: string }> {
	/**
	 * Creates another serializable test value.
	 *
	 * @param state - Complete constructor state.
	 */
	constructor(readonly state: { value: string }) {}

	/**
	 * Returns complete state accepted by the constructor.
	 *
	 * @returns Canonical constructor state.
	 */
	toJSON(): { value: string } {
		return this.state;
	}
}

let constructorCalls = 0;

/**
 * Serializable fixture that records constructor side effects.
 */
class ConstructorTrackedSerializable implements Serializable<Record<string, unknown>> {
	/**
	 * Creates one tracked test value.
	 *
	 * @param state - Constructor state supplied by deserialization.
	 */
	constructor(readonly state: Record<string, unknown>) {
		constructorCalls += 1;
	}

	/**
	 * Returns complete state accepted by the constructor.
	 *
	 * @returns Canonical constructor state.
	 */
	toJSON(): Record<string, unknown> {
		return this.state;
	}
}

/**
 * Nested custom class used to verify only the registered root is reconstructed.
 */
class NestedSerializable implements Serializable<{ value: string }> {
	/**
	 * Creates one nested custom value.
	 *
	 * @param state - Nested value state.
	 */
	constructor(readonly state: { value: string }) {}

	/**
	 * Returns nested state that the root serializer must not invoke.
	 *
	 * @returns Nested state.
	 */
	toJSON(): { value: string } {
		return this.state;
	}
}

afterEach(() => {
	clearActiveApp();
	vi.restoreAllMocks();
});

describe('Serializer', () => {
	it('reconstructs one registered root through its constructor and a real JSON boundary', async () => {
		const serializer = new Serializer({
			classes: {
				'example.value': ExampleSerializable,
			},
		});
		const source = new ExampleSerializable({
			name: 'article',
			count: 4,
			options: {
				enabled: true,
			},
		});
		const toJSON = vi.spyOn(ExampleSerializable.prototype, 'toJSON');
		const payload = serializer.serialize(source);
		const restored = await serializer.deserialize<ExampleSerializable>(
			JSON.parse(JSON.stringify(payload)),
		);

		expect(payload).toEqual({
			format: 'platform.serialized-object',
			version: 1,
			name: 'example.value',
			state: {
				name: 'article',
				count: 4,
				options: {
					enabled: true,
				},
			},
		});
		expect(toJSON).toHaveBeenCalledOnce();
		expect(restored).toBeInstanceOf(ExampleSerializable);
		expect(restored.label()).toBe('article:4');
	});

	it('preserves ordinary JSON objects while protecting reserved and prototype-sensitive keys', async () => {
		const serializer = exampleSerializer();
		const state: Record<string, unknown> = {
			name: 'safe',
			count: 1,
			options: {
				enabled: false,
			},
		};

		Object.defineProperty(state, '__proto__', {
			value: 'constructor data',
			enumerable: true,
			configurable: true,
			writable: true,
		});

		const restored = await serializer.deserialize<ExampleSerializable>(
			JSON.parse(JSON.stringify(serializer.serialize(
				new ExampleSerializable(state as unknown as ExampleState),
			))),
		);
		const restoredState = restored.toJSON() as unknown as Record<string, unknown>;

		expect(Object.hasOwn(restoredState, '__proto__')).toBe(true);
		expect(restoredState.__proto__).toBe('constructor data');
		expect({}.polluted).toBeUndefined();
		expectSerializationFailure(
			() => serializer.serialize(new ConstructorTrackedSerializable({
				$platform: 'application value',
			})),
			{
				code: 'unregistered_class',
				path: '$',
			},
		);

		const trackedSerializer = new Serializer({
			classes: {
				'tracked.value': ConstructorTrackedSerializable,
			},
		});

		expectSerializationFailure(
			() => trackedSerializer.serialize(new ConstructorTrackedSerializable({
				$platform: 'application value',
			})),
			{
				code: 'invalid_value',
				path: '$.state.$platform',
			},
		);
	});

	it('rejects non-JSON state without invoking nested toJSON methods', () => {
		const serializer = new Serializer({
			classes: {
				'tracked.value': ConstructorTrackedSerializable,
			},
		});
		const nested = new NestedSerializable({
			value: 'nested',
		});
		const nestedToJSON = vi.spyOn(nested, 'toJSON');

		for (const [state, expected] of [
			[{ nested }, { code: 'unsupported_type', path: '$.state.nested' }],
			[{ createdAt: new Date() }, { code: 'unsupported_type', path: '$.state.createdAt' }],
			[{ count: 1n }, { code: 'unsupported_type', path: '$.state.count' }],
			[{ missing: undefined }, { code: 'unsupported_type', path: '$.state.missing' }],
			[{ count: Number.NaN }, { code: 'invalid_value', path: '$.state.count' }],
		] as const) {
			expectSerializationFailure(
				() => serializer.serialize(new ConstructorTrackedSerializable(state as Record<string, unknown>)),
				expected,
			);
		}

		expect(nestedToJSON).not.toHaveBeenCalled();
	});

	it('rejects cycles but allows repeated non-cyclic JSON values', async () => {
		const serializer = new Serializer({
			classes: {
				'tracked.value': ConstructorTrackedSerializable,
			},
		});
		const circular: Record<string, unknown> = {};
		const shared = {
			value: true,
		};

		circular.self = circular;

		expectSerializationFailure(
			() => serializer.serialize(new ConstructorTrackedSerializable(circular)),
			{
				code: 'circular_reference',
				path: '$.state.self',
			},
		);

		const payload = serializer.serialize(new ConstructorTrackedSerializable({
			first: shared,
			second: shared,
		}));
		const restored = await serializer.deserialize<ConstructorTrackedSerializable>(
			JSON.parse(JSON.stringify(payload)),
		);

		expect(restored.toJSON()).toEqual({
			first: {
				value: true,
			},
			second: {
				value: true,
			},
		});
	});

	it('rejects unregistered roots and ambiguous registrations', () => {
		const serializer = new Serializer();

		expectSerializationFailure(
			() => serializer.serialize(new ExampleSerializable({
				name: 'unregistered',
				count: 1,
				options: {
					enabled: true,
				},
			})),
			{
				code: 'unregistered_class',
				path: '$',
			},
		);
		expect(() => new Serializer({
			classes: {
				'shared.name': ExampleSerializable,
			},
		}).registry.registerClass('shared.name', OtherSerializable)).toThrow(
			SerializationRegistryError,
		);
		expect(() => new Serializer({
			classes: {
				'first.name': ExampleSerializable,
			},
		}).registry.registerClass('second.name', ExampleSerializable)).toThrow(
			SerializationRegistryError,
		);
	});

	it('validates complete envelopes before construction', async () => {
		const serializer = new Serializer({
			classes: {
				'tracked.value': ConstructorTrackedSerializable,
			},
		});

		constructorCalls = 0;

		await expect(serializer.deserialize({
			format: 'platform.serialized-object',
			version: 999,
			name: 'tracked.value',
			state: {},
		})).rejects.toMatchObject({
			code: 'unsupported_version',
			path: '$.version',
		});
		await expect(serializer.deserialize({
			format: 'platform.serialized-object',
			version: 1,
			name: 'tracked.value',
			state: {
				valid: true,
				invalid: undefined,
			},
		})).rejects.toMatchObject({
			code: 'invalid_payload',
			path: '$.state.invalid',
		});
		expect(constructorCalls).toBe(0);
	});

	it('exposes one configured serializer through the active app', async () => {
		const application = new App({
			db: {} as Knex,
			serializer: {
				classes: {
					'example.value': ExampleSerializable,
				},
			},
		});

		expect(application.serializer).toBe(application.serializer);
		expect(app().serializer).toBe(application.serializer);
		expect(
			application.serializer.registry.classForName('example.value'),
		).toBe(ExampleSerializable);

		await application.close();
	});
});

/**
 * Creates the serializer used by ordinary root-object tests.
 *
 * @returns Serializer configured for ExampleSerializable.
 */
function exampleSerializer(): Serializer {
	return new Serializer({
		classes: {
			'example.value': ExampleSerializable,
		},
	});
}

/**
 * Asserts a synchronous serializer operation fails with structured details.
 *
 * @param callback - Serializer operation expected to throw.
 * @param expected - Error code and path expected from the failure.
 */
function expectSerializationFailure(
	callback: () => unknown,
	expected: Pick<SerializationError, 'code' | 'path'>,
): void {
	try {
		callback();
		throw new Error('Expected serializer operation to fail.');
	} catch (error) {
		expect(error).toBeInstanceOf(SerializationError);
		expect(error).toMatchObject(expected);
	}
}
