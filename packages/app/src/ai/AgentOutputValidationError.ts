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
		if (!isValidationCode(code)) throw new Error('Agent output validation requires a fixed symbolic code.');
		this.code = code;
	}
}

/** Validates a fixed ASCII identifier in at most 64 character checks, without regex backtracking. */
function isValidationCode(code: string): boolean {
	if (code.length < 1 || code.length > 64) return false;
	for (let index = 0; index < code.length; index++) {
		const character = code.charCodeAt(index);
		const letter = character >= 97 && character <= 122;
		const suffix = index > 0 && (character === 95 || character >= 48 && character <= 57);
		if (!letter && !suffix) return false;
	}
	return true;
}
