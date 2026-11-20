import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 4648 base32, the alphabet authenticator apps read secrets in. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Seconds each code lasts (RFC 6238 default, what every authenticator app uses). */
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;

/** Encodes bytes as unpadded base32. */
export function base32Encode(bytes: Buffer): string {
	let bits = 0; let value = 0; let output = '';
	for (const byte of bytes) {
		value = (value << 8) | byte; bits += 8;
		while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
	}
	if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
	return output;
}

/** Decodes base32, ignoring case, spaces and padding. */
export function base32Decode(text: string): Buffer {
	const clean = text.toUpperCase().replace(/[\s=-]/g, '');
	let bits = 0; let value = 0; const output: number[] = [];
	for (const character of clean) {
		const index = ALPHABET.indexOf(character);
		if (index < 0) throw new Error('The secret is not valid base32.');
		value = (value << 5) | index; bits += 5;
		if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; }
	}
	return Buffer.from(output);
}

/** A new 160-bit secret, base32, as RFC 4226 recommends. */
export function generateTotpSecret(): string {
	return base32Encode(randomBytes(20));
}

/** The time step a moment falls in. */
export function totpStep(now = Date.now()): number {
	return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/** The six-digit code for one time step (HMAC-SHA1, RFC 4226 dynamic truncation). */
export function totpCode(secret: string, step: number): string {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(step));
	const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
	const offset = digest[digest.length - 1]! & 15;
	const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
	return String(binary).padStart(DIGITS, '0');
}

/**
 * The step a code matches, allowing one step of clock drift either way, or null. Steps at or
 * before `after` are refused, so a code that was used once cannot be used again.
 */
export function matchTotp(secret: string, code: string, options: { now?: number; after?: number | null } = {}): number | null {
	const given = code.replace(/\s/g, '');
	if (!/^\d{6}$/.test(given)) return null;
	const current = totpStep(options.now);
	for (const step of [current - 1, current, current + 1]) {
		if (options.after != null && step <= options.after) continue;
		if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(given))) return step;
	}
	return null;
}

/** The otpauth:// address an authenticator app scans as a QR code. */
export function totpUri(secret: string, options: { issuer: string; account: string }): string {
	const label = encodeURIComponent(`${options.issuer}:${options.account}`);
	return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(options.issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** Ten one-time recovery codes, like `k7qp-3mzx`, for when the authenticator is lost. */
export function generateRecoveryCodes(count = 10): string[] {
	return Array.from({ length: count }, () => {
		const code = base32Encode(randomBytes(5)).toLowerCase();
		return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
	});
}

/** How a recovery code is stored: a hash of it, ignoring case, spaces and dashes. */
export function hashRecoveryCode(code: string): string {
	return createHash('sha256').update(code.toLowerCase().replace(/[\s-]/g, '')).digest('hex');
}
