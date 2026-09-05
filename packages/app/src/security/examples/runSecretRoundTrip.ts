import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import { Security, SecurityError } from '@db3.ai/app/security';
import { App } from '@db3.ai/app/server';

/**
 * Encrypts an ephemeral example secret and proves rejection of altered context/data.
 *
 * Keys are generated only for this disposable lab. No dotenv file is changed and
 * no key, plaintext or ciphertext is returned. Persistent apps must retain one key.
 *
 * @returns Non-sensitive round-trip and integrity-check outcomes.
 */
export async function runSecretRoundTrip() {
	const application = new App({ config: { security: { key: Security.generateKey() } }, dbOptions: { syncColumns: false } });
	try {
		const security = application.security;
		const context = { additionalAuthenticatedData: 'notes:ada:integration' };
		const secret = { token: 'example-secret-not-for-output' };
		const payload = security.encryptJson(secret, context);
		const second = security.encryptJson(secret, context);
		const decrypted = security.decryptJson<typeof secret>(payload, context);
		const parts = payload.split(':');
		const encryptedBytes = Buffer.from(parts[5]!, 'base64url');
		encryptedBytes[0] = encryptedBytes[0]! ^ 1;
		parts[5] = encryptedBytes.toString('base64url');
		return {
			roundTrip: decrypted.token === secret.token,
			randomized: payload !== second,
			contextRejected: rejectsSecurity(() => security.decryptJson(payload, { additionalAuthenticatedData: 'notes:grace:integration' })),
			tamperingRejected: rejectsSecurity(() => security.decryptJson(parts.join(':'), context)),
			nonJsonRejected: rejectsSecurity(() => security.encryptJson(undefined)),
		};
	} finally { await application.close(); }
}

/** Returns true only for the expected safe framework security error. */
function rejectsSecurity(operation: () => unknown): boolean {
	try { operation(); return false; } catch (error) { if (error instanceof SecurityError) return true; throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runSecretRoundTrip(), null, 2));
