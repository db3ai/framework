import {
	describe,
	expect,
	it,
} from 'vitest';
import { RequestContext } from '..';

describe('RequestContext', () => {
	it('memoizes synchronous values inside the active request context', () => {
		const context = new RequestContext();
		let calls = 0;

		const result = context.run(() => {
			const first = context.remember('example', () => {
				calls += 1;
				return 'stored-value';
			});
			const second = context.remember('example', () => {
				calls += 1;
				return 'different-value';
			});

			return [first, second];
		});

		expect(result).toEqual(['stored-value', 'stored-value']);
		expect(calls).toBe(1);
	});

	it('shares in-flight async values inside the active request context', async () => {
		const context = new RequestContext();
		let calls = 0;

		await context.run(async () => {
			const first = context.remember('example', async () => {
				calls += 1;
				return 'stored-value';
			});
			const second = context.remember('example', async () => {
				calls += 1;
				return 'different-value';
			});

			expect(second).toBe(first);
			await expect(second).resolves.toBe('stored-value');
		});

		expect(calls).toBe(1);
	});

	it('clears rejected async values so the request can retry', async () => {
		const context = new RequestContext();
		let calls = 0;

		await context.run(async () => {
			const failed = context.remember('example', async () => {
				calls += 1;
				throw new Error('Try again.');
			});

			await expect(failed).rejects.toThrow('Try again.');

			const retry = context.remember('example', async () => {
				calls += 1;
				return 'stored-value';
			});

			await expect(retry).resolves.toBe('stored-value');
		});

		expect(calls).toBe(2);
	});

	it('runs factories normally outside an active request context', () => {
		const context = new RequestContext();
		let calls = 0;

		const first = context.remember('example', () => {
			calls += 1;
			return calls;
		});
		const second = context.remember('example', () => {
			calls += 1;
			return calls;
		});

		expect([first, second]).toEqual([1, 2]);
	});
});
