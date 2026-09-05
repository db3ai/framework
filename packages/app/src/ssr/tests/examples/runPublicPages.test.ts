import { expect, it } from 'vitest';
import { runPublicPages } from '../../examples/runPublicPages';

it('renders isolated pages with literal markup, safe state and private failure recovery', async () => {
	expect(await runPublicPages()).toEqual({ status: 200, isolated: true, safeState: true, literalMarkup: true, failure: 500, privateError: true, recovered: 200, missingApi: 404 });
});
