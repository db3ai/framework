/**
 * Identifies an application-owned completion contract that was not satisfied.
 *
 * This is an ordinary error: it does not change queue retry or provider admission
 * policy. Supply a fixed application code and a payload-free operator message.
 */
export class AgentOutputValidationError extends Error {
	readonly name = 'AgentOutputValidationError';
	/** Stable application classification retained on the provider attempt. */
	readonly code: string;

	/** Creates a validation failure without retaining model output or tool payloads. */
	constructor(code: string, message: string) {
		super(message);
		if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) throw new Error('Agent output validation requires a fixed symbolic code.');
		this.code = code;
	}
}
