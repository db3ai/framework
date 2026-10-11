import { setTimeout as delay } from 'node:timers/promises';
import { FRAMEWORK_RELEASE_PACKAGES, isFrameworkReleaseVersion } from './lib/framework-release-policy.mjs';
import { readPublishedPackage, verifyPublishedTarball } from './lib/published-framework.mjs';

/**
 * Waits for npm's accepted uploads to become downloadable and checks their hashes.
 * Publication itself is never retried; a failed run can safely resume after inspection.
 * @returns {Promise<void>}
 */
async function main() {
	const version = process.argv[2];
	if (!isFrameworkReleaseVersion(version)) throw new Error('Specify the exact framework release version.');
	const pending = new Set(FRAMEWORK_RELEASE_PACKAGES.map(definition => definition.name));
	const deadline = Date.now() + 15 * 60_000;
	while (pending.size > 0 && Date.now() < deadline) {
		for (const name of pending) {
			const published = await readPublishedPackage(name, version);
			if (published && await verifyPublishedTarball(published)) {
				pending.delete(name);
				console.log(`Verified public ${name}@${version} and SHA-512 archive integrity.`);
			}
		}
		if (pending.size > 0) {
			console.log(`Waiting for npm visibility: ${[...pending].join(', ')}.`);
			await delay(30_000);
		}
	}
	if (pending.size > 0) throw new Error(`npm visibility deadline exceeded: ${[...pending].join(', ')}. Inspect registry state before rerunning; do not move the tag.`);
}

await main();
