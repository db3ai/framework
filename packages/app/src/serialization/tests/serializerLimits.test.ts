import { describe, expect, it } from 'vitest';
import { Serializer, type Serializable, type SerializedValue } from '../index';
import { UserIdentity } from '../../auth';

/** Constructor fixture retaining the complete JSON state for budget checks. */
class BudgetedState implements Serializable {
	/** Accepts state after framework validation. */
	constructor(readonly state: unknown) {}
	/** Returns the unchanged constructor state. */
	toJSON(): unknown { return this.state; }
}

describe('serializer input budgets', () => {
	it('round-trips normal state and rejects excessive depth, nodes and text before reconstruction', async () => {
		const serializer = new Serializer({ classes: { state: BudgetedState } });
		const payload = serializer.serialize(new BudgetedState({ title: 'normal', values: [1, 2, 3] }));
		expect((await serializer.deserialize<BudgetedState>(payload)).state).toEqual({ title: 'normal', values: [1, 2, 3] });
		let deep: SerializedValue = null;
		for (let index = 0; index < 70; index++) deep = { nested: deep };
		for (const state of [deep, Array(20_001).fill(null), 'x'.repeat(4_000_001)]) {
			expect(() => serializer.serialize(new BudgetedState(state))).toThrow('budget');
			await expect(serializer.deserialize({ ...payload, state })).rejects.toThrow('budget');
		}
	});

	it('rejects reference fan-out during validation before any model lookup begins', async () => {
		const serializer = new Serializer({ classes: { state: BudgetedState }, models: { user: UserIdentity } });
		const payload = serializer.serialize(new BudgetedState(null));
		const state = Array.from({ length: 257 }, (_, index) => ({ $platform: 'active-record', model: 'user', id: `user-${index}` }));
		await expect(serializer.deserialize({ ...payload, state })).rejects.toThrow('model-reference budget');
	});
});
