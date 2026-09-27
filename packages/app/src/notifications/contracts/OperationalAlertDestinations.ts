/** Configured destinations for operational alerts. Credentials are never persisted in the outbox. */
export interface OperationalAlertDestinations {
	/** Operator email address; omitted when mail delivery is disabled. */
	email?: string;
	/** Operator-controlled HTTPS endpoint. Redirects are rejected. */
	webhookUrl?: string;
	/** HMAC-SHA256 signing key required when a webhook is enabled. */
	webhookSecret?: string;
}
