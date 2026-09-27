/** App-owned operational content; callers control which diagnostic details may leave the application. */
export interface OperationalAlert {
	/** Stable incident identity; re-recording it never resets completed deliveries. */
	key: string;
	/** Short application-owned description without provider payloads or secrets. */
	summary: string;
	/** Application-allowlisted identifiers and safe diagnostic signals; never raw error messages or payloads. */
	context: Record<string, string | number | boolean | null>;
	/** Optional operator-email-only failure log and exception details, redacted by the application and limited to 128,000 characters. Never sent to webhooks. */
	emailDiagnostics?: string;
}
