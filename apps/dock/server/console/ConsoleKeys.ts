import { createHmac, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Environment variable a db3 app reads its console token from. */
export const CONSOLE_TOKEN_ENV = 'DB3_CONSOLE_TOKEN';

/**
 * The tokens Dock hands to the apps it starts, so it (and only it) can call their console API at
 * `/_db3/console`. Each project folder gets its own token, derived from one secret Dock keeps
 * beside its config, so a token stays the same across Dock restarts and an app started before a
 * restart still answers.
 */
export class ConsoleKeys {
	#secret: Buffer | null = null;

	/** @param file - Where the secret is kept, readable only by this user. */
	constructor(private readonly file: string) {}

	/** Reads the secret, creating it on first use. */
	async open(): Promise<void> {
		try {
			this.#secret = Buffer.from((await readFile(this.file, 'utf8')).trim(), 'hex');
			if (this.#secret.length >= 32) return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
		this.#secret = randomBytes(32);
		await mkdir(dirname(this.file), { recursive: true });
		await writeFile(this.file, `${this.#secret.toString('hex')}\n`, { mode: 0o600 });
		await chmod(this.file, 0o600);
	}

	/**
	 * The console token for one project folder.
	 *
	 * @param projectPath - Absolute project folder.
	 * @returns Hex token.
	 */
	token(projectPath: string): string {
		if (!this.#secret) throw new Error('ConsoleKeys.open() must run first.');
		return createHmac('sha256', this.#secret).update(`console:${projectPath}`).digest('hex');
	}
}
