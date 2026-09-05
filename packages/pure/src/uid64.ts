const UID64_ENCODING = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
const UID64_PATTERN = /^[-0-9A-Z_a-z]{22}$/;
const MAX_UID64_TIMESTAMP = 0xffffffffffff;

/**
 * Creates a 22-character, URL-safe, lexicographically sortable unique ID.
 *
 * Layout:
 * - chars 0-7: 48-bit Unix timestamp in milliseconds
 * - chars 8-21: 84 bits of cryptographic randomness
 *
 * The alphabet is base64 arranged in ASCII order, so plain string comparison
 * sorts IDs chronologically.
 *
 * @example
 * ```ts
 * const id = uid64();
 * ```
 */
export function uid64(date: Date | number = Date.now()): string {
	const timestamp = date instanceof Date ? date.getTime() : date;

	if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > MAX_UID64_TIMESTAMP) {
		throw new Error('uid64 timestamp must be a finite number between 0 and 281474976710655');
	}

	if (!globalThis.crypto?.getRandomValues) {
		throw new Error('crypto.getRandomValues() is required to generate uid64 ids');
	}

	let time = Math.floor(timestamp);
	let timeChars = '';

	for (let i = 0; i < 8; i += 1) {
		timeChars = UID64_ENCODING[time % 64] + timeChars;
		time = Math.floor(time / 64);
	}

	const random = new Uint8Array(14);

	globalThis.crypto.getRandomValues(random);

	let randomChars = '';

	for (let i = 0; i < 14; i += 1) {
		randomChars += UID64_ENCODING[random[i] & 63];
	}

	return timeChars + randomChars;
}

/**
 * Returns true when a value is a valid uid64-shaped string.
 *
 * uid64 ids are case-sensitive: `A` and `a` are distinct characters.
 */
export function isUid64(value: unknown): value is string {
	return typeof value === 'string' && UID64_PATTERN.test(value);
}

/**
 * Extracts the timestamp from a uid64 id as a `Date`.
 *
 * @example
 * ```ts
 * const createdAt = uid64Time(uid64());
 * ```
 */
export function uid64Time(value: string): Date {
	if (!isUid64(value)) {
		throw new Error('Invalid uid64');
	}

	let time = 0;

	for (let i = 0; i < 8; i += 1) {
		time = time * 64 + UID64_ENCODING.indexOf(value[i]);
	}

	return new Date(time);
}