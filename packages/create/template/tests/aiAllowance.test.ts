import { afterEach, expect, it, vi } from 'vitest';
import { AiAllowance } from '../server/ai/AiAllowance';

afterEach(() => vi.useRealTimers());

it('limits concurrent attempts and releases slots after completion or failure', () => {
	const allowance = new AiAllowance();
	const releases = ['a', 'b', 'c', 'd'].map(id => allowance.acquire(id));
	expect(() => allowance.acquire('a')).toThrow('AI is busy');
	expect(() => allowance.acquire('e')).toThrow('AI is busy');
	releases[0]();
	const release = allowance.acquire('e');
	release();
	for (const cleanup of releases) cleanup();
});

it('counts failed attempts too and expires its per-user window', () => {
	vi.useFakeTimers();
	const allowance = new AiAllowance();
	for (let index = 0; index < 10; index++) allowance.acquire('owner')();
	expect(() => allowance.acquire('owner')).toThrow('AI is busy');
	vi.advanceTimersByTime(60_001);
	expect(() => allowance.acquire('owner')()).not.toThrow();
});
