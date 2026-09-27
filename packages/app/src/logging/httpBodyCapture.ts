import type { HttpBodyLog } from './contracts';

const maximumCapturedProperties = 2_000;
const maximumCaptureDepth = 12;
const maximumHeaderValueLength = 4_096;
const redactedValue = '[Redacted]';

/**
 * Mutable limits used while producing a bounded JSON-safe body value.
 */
interface BodySanitizationState {
	/** Objects already visited while guarding against circular structures. */
	seen: WeakSet<object>;
	/** Remaining object properties or array items allowed in the capture. */
	remainingProperties: number;
}

/**
 * Captures one request or response body without retaining unbounded payloads.
 *
 * @param payload - Parsed request body or outgoing Fastify payload.
 * @param contentType - Media type reported by the HTTP message.
 * @param maxBodyBytes - Maximum UTF-8 bytes retained in the log record.
 * @returns Bounded body metadata and an inspectable value when safe.
 */
export function captureBody(
	payload: unknown,
	contentType: string | undefined,
	maxBodyBytes: number,
): HttpBodyLog {
	if (payload === undefined || payload === null || payload === '') {
		return {
			kind: 'empty',
			contentType,
		};
	}

	if (isStreamLike(payload)) {
		return {
			kind: 'stream',
			contentType,
			note: 'Streaming response body omitted.',
		};
	}

	if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) {
		const buffer = Buffer.from(payload);

		if (!isTextContentType(contentType)) {
			return {
				kind: 'binary',
				contentType,
				sizeBytes: buffer.byteLength,
				note: 'Binary body omitted.',
			};
		}

		return captureText(buffer.toString('utf8'), contentType, maxBodyBytes);
	}

	if (typeof payload === 'string') {
		return captureText(payload, contentType, maxBodyBytes);
	}

	return captureJson(payload, contentType, maxBodyBytes);
}

/**
 * Captures textual content, parsing JSON so nested secrets can be redacted.
 *
 * @param value - Original textual payload.
 * @param contentType - Media type reported by the HTTP message.
 * @param maxBodyBytes - Maximum UTF-8 bytes retained in the log record.
 * @returns Text or JSON body capture.
 */
function captureText(
	value: string,
	contentType: string | undefined,
	maxBodyBytes: number,
): HttpBodyLog {
	if (isFormContentType(contentType)) {
		return captureJson(formBodyFromText(value), contentType, maxBodyBytes);
	}

	if (isJsonContentType(contentType) || looksLikeJson(value)) {
		try {
			return captureJson(JSON.parse(value), contentType, maxBodyBytes);
		} catch {
			// Malformed JSON remains useful as bounded response text.
		}
	}

	const sizeBytes = Buffer.byteLength(value);

	return {
		kind: 'text',
		contentType,
		sizeBytes,
		truncated: sizeBytes > maxBodyBytes,
		value: truncateUtf8(value, maxBodyBytes),
	};
}

/**
 * Converts URL-encoded form text into a shape that supports field redaction.
 *
 * Repeated form keys remain arrays so the inspector does not silently discard
 * submitted values.
 *
 * @param value - URL-encoded request body.
 * @returns Parsed form object suitable for normal JSON sanitization.
 */
function formBodyFromText(value: string): Record<string, string | string[]> {
	const captured: Record<string, string | string[]> = {};

	for (const [key, item] of new URLSearchParams(value)) {
		const existing = captured[key];

		if (existing === undefined) {
			captured[key] = item;
			continue;
		}

		captured[key] = Array.isArray(existing)
			? [...existing, item]
			: [existing, item];
	}

	return captured;
}

/**
 * Produces a JSON-safe, recursively redacted representation of a payload.
 *
 * @param value - Parsed body value.
 * @param contentType - Media type reported by the HTTP message.
 * @param maxBodyBytes - Maximum UTF-8 bytes retained in the log record.
 * @returns JSON body capture.
 */
function captureJson(
	value: unknown,
	contentType: string | undefined,
	maxBodyBytes: number,
): HttpBodyLog {
	const sanitized = sanitizeBodyValue(value, '', {
		seen: new WeakSet<object>(),
		remainingProperties: maximumCapturedProperties,
	});
	const serialized = JSON.stringify(sanitized);

	if (serialized === undefined) {
		return captureText(String(value), contentType, maxBodyBytes);
	}

	const sizeBytes = Buffer.byteLength(serialized);

	return {
		kind: 'json',
		contentType,
		sizeBytes,
		truncated: sizeBytes > maxBodyBytes,
		value: sizeBytes > maxBodyBytes
			? truncateUtf8(serialized, maxBodyBytes)
			: sanitized,
	};
}

/**
 * Recursively removes sensitive fields and bounds complex object traversal.
 *
 * @param value - Current body value.
 * @param key - Owning object key used for sensitive-name detection.
 * @param state - Shared circular-reference and property-count state.
 * @param depth - Current traversal depth.
 * @returns JSON-safe value suitable for structured logging.
 */
function sanitizeBodyValue(
	value: unknown,
	key: string,
	state: BodySanitizationState,
	depth = 0,
): unknown {
	if (isSensitiveName(key)) return redactedValue;
	if (value === null || value === undefined) return value;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'bigint') return value.toString();
	if (typeof value !== 'object') return String(value);
	if (state.seen.has(value)) return '[Circular]';
	if (depth >= maximumCaptureDepth) return '[Maximum depth reached]';

	state.seen.add(value);

	if (value instanceof Date) return value.toISOString();
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}
	if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
		return `[Binary ${value.byteLength} bytes]`;
	}

	if (Array.isArray(value)) {
		const captured: unknown[] = [];

		for (const item of value) {
			if (state.remainingProperties <= 0) {
				captured.push('[Capture limit reached]');
				break;
			}

			state.remainingProperties -= 1;
			captured.push(sanitizeBodyValue(item, '', state, depth + 1));
		}

		return captured;
	}

	const captured: Record<string, unknown> = {};

	for (const [childKey, childValue] of Object.entries(value)) {
		if (state.remainingProperties <= 0) {
			captured['[capture]'] = 'Property limit reached';
			break;
		}

		state.remainingProperties -= 1;
		captured[childKey] = sanitizeBodyValue(childValue, childKey, state, depth + 1);
	}

	return captured;
}

/**
 * Redacts credential-bearing headers before a record reaches Pino.
 *
 * @param headers - Fastify request or response header collection.
 * @returns Header object safe for local request inspection.
 */
export function redactHeaders(
	headers: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	const captured: Record<string, unknown> = {};

	for (const [name, value] of Object.entries(headers)) {
		captured[name] = isSensitiveName(name)
			? redactedValue
			: boundedHeaderValue(value);
	}

	return captured;
}

/**
 * Bounds one response or request header value.
 *
 * @param value - Original Fastify header value.
 * @returns Original scalar shape with long strings shortened.
 */
function boundedHeaderValue(value: unknown): unknown {
	if (typeof value === 'string') {
		return value.length > maximumHeaderValueLength
			? `${value.slice(0, maximumHeaderValueLength)}…`
			: value;
	}

	if (Array.isArray(value)) {
		return value.map(item => boundedHeaderValue(item));
	}

	return value;
}

/**
 * Detects common credential and session field names.
 *
 * @param name - Header or JSON property name.
 * @returns True when the value must be removed from the capture.
 */
function isSensitiveName(name: string): boolean {
	const normalized = name.toLowerCase().replace(/[-_]/g, '');

	return normalized === 'authorization'
		|| normalized === 'proxyauthorization'
		|| normalized === 'cookie'
		|| normalized === 'setcookie'
		|| normalized === 'password'
		|| normalized === 'passphrase'
		|| normalized === 'secret'
		|| normalized === 'token'
		|| normalized === 'accesstoken'
		|| normalized === 'refreshtoken'
		|| normalized === 'apikey'
		|| normalized === 'xapikey';
}

/**
 * Converts a Fastify header into one displayable content-type string.
 *
 * @param value - Request or response content-type header.
 * @returns First string value when present.
 */
export function headerValue(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (Array.isArray(value) && typeof value[0] === 'string') return value[0];

	return undefined;
}

/**
 * Identifies payloads that Fastify will stream instead of serialize.
 *
 * @param value - Candidate outgoing response payload.
 * @returns True when the value exposes the Node stream pipe contract.
 */
function isStreamLike(value: unknown): boolean {
	return typeof value === 'object'
		&& value !== null
		&& 'pipe' in value
		&& typeof value.pipe === 'function';
}

/**
 * Identifies media types that are safe to decode as UTF-8 text.
 *
 * @param contentType - HTTP content type.
 * @returns True for JSON and common textual media types.
 */
function isTextContentType(contentType: string | undefined): boolean {
	const normalized = (contentType || '').toLowerCase();

	return normalized.startsWith('text/')
		|| normalized.includes('json')
		|| normalized.includes('xml')
		|| normalized.includes('javascript')
		|| normalized.includes('x-www-form-urlencoded')
		|| normalized.includes('svg');
}

/**
 * Identifies JSON media types.
 *
 * @param contentType - HTTP content type.
 * @returns True when the media type uses JSON.
 */
function isJsonContentType(contentType: string | undefined): boolean {
	return (contentType || '').toLowerCase().includes('json');
}

/**
 * Identifies URL-encoded form media types requiring field-level redaction.
 *
 * @param contentType - HTTP content type.
 * @returns True when the body uses URL-encoded form syntax.
 */
function isFormContentType(contentType: string | undefined): boolean {
	return (contentType || '').toLowerCase().includes('x-www-form-urlencoded');
}

/**
 * Detects likely JSON text when a content type was omitted or incorrect.
 *
 * @param value - Textual payload.
 * @returns True when the trimmed body begins with a JSON container.
 */
function looksLikeJson(value: string): boolean {
	const trimmed = value.trim();

	return (trimmed.startsWith('{') && trimmed.endsWith('}'))
		|| (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

/**
 * Truncates text by UTF-8 byte length rather than JavaScript character count.
 *
 * @param value - Original text.
 * @param maxBytes - Maximum bytes to retain.
 * @returns Original or shortened UTF-8 text.
 */
function truncateUtf8(value: string, maxBytes: number): string {
	const buffer = Buffer.from(value);

	if (buffer.byteLength <= maxBytes) return value;

	const marker = '…';
	const contentBytes = Math.max(0, maxBytes - Buffer.byteLength(marker));

	return `${buffer.subarray(0, contentBytes).toString('utf8')}…`;
}
