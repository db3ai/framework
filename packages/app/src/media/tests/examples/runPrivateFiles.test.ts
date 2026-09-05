import { expect, it } from 'vitest';
import { runPrivateFiles } from '../../examples/runPrivateFiles';

it('protects real managed files across users and rejects invalid uploads without writes', async () => {
	expect(await runPrivateFiles()).toEqual({ uploaded: 201, text: 'Private client brief', unsigned: 401, stranger: 404, strangerDelete: 404, empty: 400, wrongType: 400, oversized: 413, failedWritesAbsent: true, privateHeaders: true, deleted: 204, bytesRemoved: true, missing: 404, retry: 201 });
});
