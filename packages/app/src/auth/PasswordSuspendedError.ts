import type { PasswordSuspension } from './contracts';

/**
 * Password sign-in for the submitted identity requires email recovery.
 * The same error is used for existing and unknown emails, with no account data.
 */
export class PasswordSuspendedError extends Error {
	/** Creates a generic refusal, optionally carrying a newly committed transition for server use. */
	constructor(readonly suspension: PasswordSuspension | null = null) {
		super('Too many sign-in attempts. Use password recovery to continue.');
		this.name = 'PasswordSuspendedError';
	}
}
