import { describe, expect, it, vi } from 'vitest';
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

	it('limits concurrent distinct model lookups after validating the complete payload', async () => {
		const serializer = new Serializer({ classes: { state: BudgetedState }, models: { user: UserIdentity } });
		const payload = serializer.serialize(new BudgetedState(null));
		const state = Array.from({ length: 24 }, (_, index) => ({ $platform: 'active-record', model: 'user', id: `user-${index}` }));
		let active = 0;
		let peak = 0;
		const find = vi.spyOn(UserIdentity, 'findOrFail').mockImplementation(async () => {
			active++;
			peak = Math.max(peak, active);
			try {
				await new Promise(resolve => setTimeout(resolve, 5));
				return Object.create(UserIdentity.prototype) as UserIdentity;
			} finally {
				active--;
			}
		});
		try {
			const restored = await serializer.deserialize<BudgetedState>({ ...payload, state });
			expect((restored.state as UserIdentity[])).toHaveLength(24);
			expect(find).toHaveBeenCalledTimes(24);
			expect(peak).toBe(8);
		} finally {
			find.mockRestore();
		}
	});
});
