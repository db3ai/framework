import {
	randomBytes,
	scrypt,
	timingSafeEqual,
	type ScryptOptions,
} from 'node:crypto';

export interface PasswordHash {
	hash(plainText: string): Promise<string>;
	verify(plainText: string, hash: string): Promise<boolean>;
}

export interface ScryptPasswordHashOptions {
	cost?: number;
	blockSize?: number;
	parallelization?: number;
	keyLength?: number;
	saltLength?: number;
	maxmem?: number;
}

const HASH_ALGORITHM = 'scrypt';
const HASH_VERSION = '1';

export class ScryptPasswordHash implements PasswordHash {
	private readonly cost: number;
	private readonly blockSize: number;
	private readonly parallelization: number;
	private readonly keyLength: number;
	private readonly saltLength: number;
	private readonly maxmem?: number;

	constructor(options: ScryptPasswordHashOptions = {}) {
		this.cost = options.cost ?? 16384;
		this.blockSize = options.blockSize ?? 8;
		this.parallelization = options.parallelization ?? 1;
		this.keyLength = options.keyLength ?? 64;
		this.saltLength = options.saltLength ?? 16;
		this.maxmem = options.maxmem;
	}

	async hash(plainText: string): Promise<string> {
		const salt = randomBytes(this.saltLength).toString('hex');
		const hash = await this.derive(plainText, salt, this.keyLength);

		return [
			HASH_ALGORITHM,
			HASH_VERSION,
			String(this.cost),
			String(this.blockSize),
			String(this.parallelization),
			String(this.keyLength),
			salt,
			hash.toString('hex'),
		].join('$');
	}

	async verify(plainText: string, hash: string): Promise<boolean> {
		const parsed = this.parse(hash);

		if (!parsed) {
			return false;
		}

		const actual = await this.derive(plainText, parsed.salt, parsed.keyLength, {
			cost: parsed.cost,
			blockSize: parsed.blockSize,
			parallelization: parsed.parallelization,
		});
		const expected = Buffer.from(parsed.hash, 'hex');

		return actual.length === expected.length && timingSafeEqual(actual, expected);
	}

	private derive(
		plainText: string,
		salt: string,
		keyLength: number,
		options: Partial<ScryptPasswordHashOptions> = {},
	): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const scryptOptions: ScryptOptions = {
				N: options.cost ?? this.cost,
				r: options.blockSize ?? this.blockSize,
				p: options.parallelization ?? this.parallelization,
				maxmem: this.maxmem,
			};

			scrypt(plainText, salt, keyLength, scryptOptions, (error, derivedKey) => {
				if (error) {
					reject(error);
					return;
				}

				resolve(derivedKey as Buffer);
			});
		});
	}

	private parse(hash: string): ParsedScryptHash | null {
		const [
			algorithm,
			version,
			cost,
			blockSize,
			parallelization,
			keyLength,
			salt,
			digest,
		] = hash.split('$');

		if (
			algorithm !== HASH_ALGORITHM
			|| version !== HASH_VERSION
			|| !cost
			|| !blockSize
			|| !parallelization
			|| !keyLength
			|| !salt
			|| !digest
		) {
			return null;
		}

		const parsed = {
			cost: Number(cost),
			blockSize: Number(blockSize),
			parallelization: Number(parallelization),
			keyLength: Number(keyLength),
			salt,
			hash: digest,
		};

		if (
			!Number.isSafeInteger(parsed.cost)
			|| !Number.isSafeInteger(parsed.blockSize)
			|| !Number.isSafeInteger(parsed.parallelization)
			|| !Number.isSafeInteger(parsed.keyLength)
			|| parsed.cost <= 1
			|| parsed.blockSize <= 0
			|| parsed.parallelization <= 0
			|| parsed.keyLength <= 0
		) {
			return null;
		}

		return parsed;
	}
}

export const defaultPasswordHash = new ScryptPasswordHash();

interface ParsedScryptHash {
	cost: number;
	blockSize: number;
	parallelization: number;
	keyLength: number;
	salt: string;
	hash: string;
}
