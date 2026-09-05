import { expect, it } from 'vitest';
import { runProjectMedia } from '../../examples/runProjectMedia';

it('runs the project media guide with scoped SQL reads, real streams and cleanup', async () => {
	expect(await runProjectMedia()).toEqual({
		text: 'Client brief', path: '/Briefs/brief.txt', duplicatePath: '/Briefs/brief-2.txt',
		private: true, crossProjectRejected: true, deleted: true, placementRemoved: true,
	});
});
