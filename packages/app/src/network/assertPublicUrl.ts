import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BlockedUrlError } from './BlockedUrlError';
import { isPrivateHostname, isPrivateIpAddress, normalizedUrlHostname } from './privateNetworkAddresses';
import type * as network from './contracts';

/**
 * Validates that a URL is an HTTP(S) address on the public internet.
 *
 * This is a pre-flight check that gives users a clear error before any
 * connection is attempted. It is not sufficient on its own: DNS can return a
 * different address when the request connects (DNS rebinding). Send requests
 * through {@link guardedFetch}, or pass {@link publicAddressLookup} to the HTTP
 * client, so the connected address is checked as well.
 *
 * @param rawUrl - Absolute URL supplied by a user, crawler or redirect.
 * @param options - Destination policy; private hosts are refused by default.
 * @throws {BlockedUrlError} When the URL is malformed, not HTTP(S), or reaches
 * a private, local or reserved address.
 *
 * @example
 * await assertPublicUrl('https://example.com/feed.xml');
 * await assertPublicUrl('http://169.254.169.254/'); // throws BlockedUrlError
 */
export async function assertPublicUrl(rawUrl: string, options: network.PublicUrlOptions = {}): Promise<void> {
	const hostname = publicUrlHostname(rawUrl, options);

	if (hostname === null || isIP(hostname)) return;

	let addresses: Array<{ address: string }>;

	try {
		addresses = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		throw new BlockedUrlError('Unable to resolve the URL hostname.');
	}

	if (addresses.length === 0 || addresses.some(entry => isPrivateIpAddress(entry.address))) {
		throw new BlockedUrlError(PRIVATE_DESTINATION_MESSAGE);
	}
}

/** Public explanation used for every private, local or reserved destination. */
export const PRIVATE_DESTINATION_MESSAGE = 'Private, local, or reserved URLs are not allowed.';

/**
 * Performs the synchronous part of URL validation.
 *
 * @param rawUrl - Absolute URL to validate.
 * @param options - Destination policy.
 * @returns Normalized hostname still requiring DNS validation, or null when no
 * further checks are needed because private destinations are allowed.
 * @throws {BlockedUrlError} When the URL fails a synchronous rule.
 */
function publicUrlHostname(rawUrl: string, options: network.PublicUrlOptions): string | null {
	let parsed: URL;

	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new BlockedUrlError('The URL is not valid.');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new BlockedUrlError('Only http and https URLs are allowed.');
	}

	if (options.allowPrivate) return null;

	const hostname = normalizedUrlHostname(parsed.hostname);

	if (isPrivateHostname(hostname) || (isIP(hostname) && isPrivateIpAddress(hostname))) {
		throw new BlockedUrlError(PRIVATE_DESTINATION_MESSAGE);
	}

	return hostname;
}
