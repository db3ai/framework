import { expect, it } from 'vitest';
import { runStreamExport } from '../../examples/runStreamExport';

it('streams a large export, preserves the previous file on interruption and cleans partial bytes', async () => {
	expect(await runStreamExport()).toEqual({ lines: 50_001, complete: true, interruptionRejected: true, previousPreserved: true, pendingFiles: 0, repaired: true });
});
