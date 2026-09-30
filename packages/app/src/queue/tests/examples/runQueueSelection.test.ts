import { expect, it } from 'vitest';
import { runQueueSelection } from '../../examples/runQueueSelection';

it('keeps article and image work available for shared workers while protecting the general worker', async () => {
	expect(await runQueueSelection()).toEqual({ handled: ['default', 'article-images', 'articles'], protectedIdle: true, remaining: 0 });
});
