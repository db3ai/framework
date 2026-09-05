/**
 * Serializer operation that rejected a runtime or durable value.
 */
export type SerializationOperation = 'serialize' | 'deserialize';

const MAX_ERROR_PATH_LENGTH = 500;
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Stable failure categories exposed by SerializationError.
 */
export type SerializationErrorCode =
	| 'unsupported_type'
	| 'invalid_value'
	| 'circular_reference'
	| 'unregistered_class'
	| 'unregistered_model'
	| 'unsaved_active_record'
	| 'dirty_active_record'
	| 'trashed_active_record'
	| 'active_record_not_found'
	| 'active_record_restore_failed'
	| 'invalid_payload'
	| 'unsupported_version'
	| 'class_construction_failed';

/**
 * Structured details used to create a safe serializer failure.
 */
export interface SerializationErrorOptions {
	/** Operation that raised the failure. */
	operation: SerializationOperation;
	/** Stable machine-readable failure category. */
	code: SerializationErrorCode;
	/** JSONPath-like location of the rejected value. */
	path: string;
	/** Safe explanation that does not stringify the rejected value. */
	message: string;
	/** Lower-level error retained for diagnostics. */
	cause?: unknown;
}

/**
 * Error raised when runtime state cannot be serialized or restored losslessly.
 */
export class SerializationError extends Error {
	/** Operation that raised this error. */
	readonly operation: SerializationOperation;

	/** Stable machine-readable failure category. */
	readonly code: SerializationErrorCode;

	/** JSONPath-like location of the rejected value. */
	readonly path: string;

	/**
	 * Creates one path-aware serializer failure.
	 *
	 * @param options - Safe structured failure details.
	 */
	constructor(options: SerializationErrorOptions) {
		const path = safeErrorText(options.path, MAX_ERROR_PATH_LENGTH);
		const message = safeErrorText(options.message, MAX_ERROR_MESSAGE_LENGTH);

		super(
			`${options.operation === 'serialize' ? 'Cannot serialize' : 'Cannot deserialize'} ${path}: ${message}`,
			options.cause === undefined ? undefined : {
				cause: options.cause,
			},
		);
		this.name = 'SerializationError';
		this.operation = options.operation;
		this.code = options.code;
		this.path = path;
	}
}

/**
 * Bounds and flattens diagnostic text derived from serialized input paths.
 *
 * @param value - Diagnostic string to make safe for logs and error responses.
 * @param maxLength - Maximum retained string length.
 * @returns Single-line bounded diagnostic text.
 */
function safeErrorText(value: string, maxLength: number): string {
	const flattened = value.replace(/[\u0000-\u001f\u007f]/g, ' ');

	return flattened.length <= maxLength
		? flattened
		: `${flattened.slice(0, maxLength - 1)}…`;
}
