import { createHash } from 'node:crypto';

const REGISTRY = 'https://registry.npmjs.org';

/**
 * Reads one immutable release from the public registry, treating only 404 as absent.
 * Authentication, server and malformed metadata failures stop publication.
 *
 * @param {string} name - Scoped package name.
 * @param {string} version - Exact release version.
 * @param {typeof fetch} request - HTTP boundary for deterministic failure tests.
 * @returns {Promise<{integrity: string, tarball: string} | null>} Public artifact identity.
 */
export async function readPublishedPackage(name, version, request = fetch) {
	const response = await request(`${REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(30_000), headers: { 'cache-control': 'no-cache' } });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Registry metadata for ${name}: HTTP ${response.status}.`);
	const manifest = await response.json();
	if (manifest.name !== name || manifest.version !== version || !manifest.dist?.integrity?.startsWith('sha512-') || !manifest.dist?.tarball) {
		throw new Error(`Invalid registry identity for ${name}@${version}.`);
	}
	const url = new URL(manifest.dist.tarball);
	if (url.origin !== REGISTRY) throw new Error(`Unexpected tarball origin for ${name}.`);
	return { integrity: manifest.dist.integrity, tarball: url.href };
}

/**
 * Confirms the registry serves the archive described by its immutable metadata.
 * A 404 means propagation is incomplete; other failures stop verification.
 *
 * @param {{integrity: string, tarball: string}} published - Expected artifact.
 * @param {typeof fetch} request - HTTP boundary.
 * @returns {Promise<boolean>} Whether the archive is available and its hash matches.
 */
export async function verifyPublishedTarball(published, request = fetch) {
	const response = await request(published.tarball, { signal: AbortSignal.timeout(60_000) });
	if (response.status === 404) return false;
	if (!response.ok) throw new Error(`Registry tarball: HTTP ${response.status}.`);
	const integrity = `sha512-${createHash('sha512').update(Buffer.from(await response.arrayBuffer())).digest('base64')}`;
	if (integrity !== published.integrity) throw new Error('Published tarball integrity mismatch.');
	return true;
}
