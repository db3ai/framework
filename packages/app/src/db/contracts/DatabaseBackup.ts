/**
 * Application-provided implementation behind the database backup API.
 *
 * The database package owns the stable invocation surface while each app owns
 * the concrete dump format, storage destinations, and retention policy.
 */
export type DatabaseBackupHandler = (request: Record<string, unknown>) => Promise<unknown>;
