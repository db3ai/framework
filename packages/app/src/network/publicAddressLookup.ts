import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { BlockedUrlError } from './BlockedUrlError';
import { PRIVATE_DESTINATION_MESSAGE } from './assertPublicUrl';
import { isPrivateIpAddress } from './privateNetworkAddresses';

/** Callback shape used by `dns.lookup` for both single and `all` results. */
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * DNS lookup that refuses to connect to private, local or reserved addresses.
 *
 * It has the same signature as `dns.lookup`, so it can be passed as the
 * `lookup` socket option of Node's `http`, `https`, `net` and `tls` modules and
 * to clients built on them (for example undici's `connect.lookup` or got's
 * `dnsLookup`). Because the check runs when the socket connects, the address
 * that is validated is the address that is used, which closes the DNS
 * rebinding gap left by checking a hostname before a separate request.
 *
 * Node does not call `lookup` for IP-literal hosts, so literals (including
 * redirect targets) must still be checked with {@link assertPublicUrl}.
 *
 * @param hostname - Hostname being connected to.
 * @param options - Lookup options supplied by the socket layer.
 * @param callback - Receives the validated address(es) or a `BlockedUrlError`.
 *
 * @example
 * import { Agent } from 'undici';
 * const dispatcher = new Agent({ connect: { lookup: publicAddressLookup } });
 */
export function publicAddressLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) {
			callback(error, []);
			return;
		}

		if (addresses.length === 0 || addresses.some(entry => isPrivateIpAddress(entry.address))) {
			callback(Object.assign(new BlockedUrlError(PRIVATE_DESTINATION_MESSAGE), { code: 'ERR_BLOCKED_ADDRESS' }), []);
			return;
		}

		if (options.all) {
			callback(null, addresses);
			return;
		}

		callback(null, addresses[0]!.address, addresses[0]!.family);
	});
}
