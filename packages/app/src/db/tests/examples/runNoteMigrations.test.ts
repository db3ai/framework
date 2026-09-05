import { expect, it } from 'vitest';
import { runNoteMigrations } from '../../examples/runNoteMigrations';

it('generates, applies, blocks unsafe changes and recovers with an additive migration', async () => {
	expect(await runNoteMigrations()).toEqual({ initialGenerated: true, unsafeBlocked: true, blockedPreservedSource: true, repairedGenerated: true, pendingBefore: 1, applied: 1, matches: true, titlePreserved: true, categoryNullable: true });
});
