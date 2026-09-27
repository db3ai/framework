/**
 * Destination policy shared by every outbound network guard.
 *
 * Applications decide the policy (for example from their environment) and pass
 * it to each guarded operation. The guard itself never reads environment
 * variables, so a request handler cannot widen the policy through input.
 */
export interface PublicUrlOptions {
	/**
	 * Allows private, loopback and reserved destinations.
	 *
	 * Intended for interactive local development, where integrations are often
	 * tested against `localhost` receivers. Production code should leave this
	 * unset so user-supplied URLs can only reach public internet hosts.
	 */
	allowPrivate?: boolean;
}
