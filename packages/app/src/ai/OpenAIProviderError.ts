/**
 * Normalized OpenAI provider failure fields used by application retry policy.
 */
export interface OpenAIProviderErrorDetails {
	/** Provider error code, when supplied by the SDK or response payload. */
	code: string | null;
	/** HTTP status, when the provider rejected the request before streaming began. */
	status: number | null;
	/** Provider request identifier used for support and diagnostics. */
	requestId: string | null;
	/** Human-readable provider failure message. */
	message: string;
}

const OPENAI_QUOTA_ERROR_CODES = new Set([
	'billing_hard_limit_reached',
	'insufficient_quota',
]);

/**
 * Extracts stable OpenAI failure fields from SDK errors or response payloads.
 *
 * Streaming Responses failures can carry no HTTP status while still exposing a
 * provider `code`, so callers must not classify them from status alone.
 *
 * @param value - Unknown SDK error or provider response payload.
 * @returns Normalized provider failure details.
 */
export function openAIProviderError(value: unknown): OpenAIProviderErrorDetails {
	const record = objectRecord(value);
	const nestedError = objectRecord(record?.error);
	const code = stringField(record?.code)
		?? stringField(nestedError?.code);
	const status = numberField(record?.status);
	const requestId = stringField(record?.requestID)
		?? stringField(record?.requestId)
		?? stringField(nestedError?.request_id);
	const message = value instanceof Error
		? value.message
		: stringField(record?.message)
			?? stringField(nestedError?.message)
			?? 'OpenAI request failed.';

	return {
		code,
		status,
		requestId,
		message,
	};
}

/**
 * Checks whether an OpenAI failure represents exhausted account or project quota.
 *
 * @param value - Unknown SDK error or provider response payload.
 * @returns True when the provider error code requires credits or billing changes.
 */
export function isOpenAIQuotaError(value: unknown): boolean {
	const code = openAIProviderError(value).code;

	return (code !== null && OPENAI_QUOTA_ERROR_CODES.has(code)) || /\b(?:you have )?no credits remaining\b/i.test(openAIProviderError(value).message);
}

/**
 * Narrows an unknown value to a non-array object record.
 *
 * @param value - Unknown value to inspect.
 * @returns Object record, or null for unsupported values.
 */
function objectRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

/**
 * Returns a non-empty string field.
 *
 * @param value - Unknown field value.
 * @returns Trimmed string, or null.
 */
function stringField(value: unknown): string | null {
	return typeof value === 'string' && value.trim()
		? value.trim()
		: null;
}

/**
 * Returns a finite numeric field.
 *
 * @param value - Unknown field value.
 * @returns Finite number, or null.
 */
function numberField(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: null;
}
