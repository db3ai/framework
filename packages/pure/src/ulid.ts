const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;
const MAX_ULID_TIMESTAMP = 0xffffffffffff;

/**
 * Creates a canonical, crypto-random ULID string.
 *
 * The timestamp portion is encoded from the provided date or timestamp, and the
 * random portion is filled with `crypto.getRandomValues()`.
 *
 * @example
 * ```ts
 * const id = ulid();
 * ```
 */
export function ulid(date: Date | number = Date.now()): string {
	const timestamp = date instanceof Date ? date.getTime() : date;

	if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > MAX_ULID_TIMESTAMP) {
		throw new Error('ULID timestamp must be a finite number between 0 and 281474976710655');
	}

	let time = Math.floor(timestamp);
	let timeChars = '';

	for (let i = 0; i < 10; i += 1) {
		timeChars = ULID_ENCODING[time % 32] + timeChars;
		time = Math.floor(time / 32);
	}

	if (!globalThis.crypto?.getRandomValues) {
		throw new Error('crypto.getRandomValues() is required to generate ULIDs');
	}

	const random = new Uint8Array(16);

	globalThis.crypto.getRandomValues(random);

	let randomChars = '';

	for (let i = 0; i < 16; i += 1) {
		randomChars += ULID_ENCODING[random[i] & 31];
	}

	return timeChars + randomChars;
}

/**
 * Returns true when a value is a valid ULID-shaped string.
 *
 * ULIDs use Crockford Base32 and exclude I, L, O, and U.
 */
export function isUlid(value: unknown): value is string {
	return typeof value === 'string' && ULID_PATTERN.test(value);
}

/**
 * Extracts the timestamp from a ULID as a `Date`.
 *
 * Accepts lowercase input, since `isUlid` does.
 *
 * @example
 * ```ts
 * const createdAt = ulidTime('01J9XQ3Z5H8B2M4N6P7Q9R0S1T');
 * ```
 */
export function ulidTime(value: string): Date {
	if (!isUlid(value)) {
		throw new Error('Invalid ULID');
	}

	let time = 0;

	for (let i = 0; i < 10; i += 1) {
		time = time * 32 + ULID_ENCODING.indexOf(value[i].toUpperCase());
	}

	return new Date(time);
}