/** Identifies a newly committed suspension so an application can enqueue recovery notices. */
export interface PasswordSuspension {
	/** Attempt-state record, equally available for registered and unknown identities. */
	attemptId: string;
	/** Unique suspension occurrence; changes after recovery and a later suspension. */
	suspensionId: string;
}
