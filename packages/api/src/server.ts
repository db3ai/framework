import type { FastifyInstance } from 'fastify';
import type { ApiOptions } from './contracts';

/**
 * Serves the public API under `/_db3/api/v1` and the manifest at `/_db3/api/manifest`.
 *
 * Contract (see tests/api.contract.test.ts):
 * - Off unless `db3/api.json` says `enabled: true`; routes not listed are `off` and answer 404.
 * - Keys: `Authorization: Bearer db3_sk_…` (secret) or `db3_pk_…` (publishable). Secret keys are
 *   refused from browsers (any request with an Origin header).
 * - Browser calls must come from an origin in `origins`; preflight answers for those origins only.
 * - `user` routes also need a signed-in end user, found by `users`.
 * - Bodies are checked against each route's `input`; refusals answer `{ error, code }`.
 *
 * @param server - The environment's Fastify server.
 * @param options - Settings, keys, services and the end-user resolver, each a narrow port.
 */
export async function registerApi(server: FastifyInstance, options: ApiOptions): Promise<void> {
	void server;
	void options;
	throw new Error('registerApi is a contract stub: confirm the contract tests before it is built.');
}
