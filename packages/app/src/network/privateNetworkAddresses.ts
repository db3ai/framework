import { isIP } from 'node:net';

/**
 * Normalizes a URL hostname for address classification.
 *
 * WHATWG URL parsing already canonicalizes numeric IPv4 forms such as
 * `2130706433` and `0x7f.1`. This helper additionally lowercases the value,
 * removes IPv6 brackets and drops one trailing root-label dot so `localhost.`
 * and `localhost` are treated the same.
 *
 * @param hostname - `URL.hostname` value to normalize.
 * @returns Lowercase hostname or IP literal without brackets or a trailing dot.
 *
 * @example
 * normalizedUrlHostname(new URL('http://[::1]/').hostname); // '::1'
 */
export function normalizedUrlHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/**
 * Checks whether a hostname is reserved for the local machine.
 *
 * DNS names are otherwise judged by the addresses they resolve to, so this
 * only covers names that never need a DNS query to reach loopback.
 *
 * @param hostname - Hostname normalized with {@link normalizedUrlHostname}.
 * @returns True for `localhost` and any `*.localhost` name.
 */
export function isPrivateHostname(hostname: string): boolean {
	return hostname === 'localhost' || hostname.endsWith('.localhost');
}

/**
 * Checks whether an IP address must not be reached by server-side requests.
 *
 * The policy blocks loopback, private, link-local (including cloud metadata),
 * carrier-grade NAT, benchmarking, documentation, multicast and reserved
 * ranges. IPv6 forms that embed an IPv4 address (mapped, NAT64 and 6to4) are
 * judged by the embedded address, and tunnelling or deprecated forms that can
 * reach IPv4 hosts indirectly are blocked outright. Values that are not valid
 * IP literals return false so callers can resolve them as hostnames instead.
 *
 * @param address - IPv4 or IPv6 literal, with or without IPv6 brackets.
 * @returns True when the address is private, local or reserved.
 *
 * @example
 * isPrivateIpAddress('169.254.169.254'); // true
 * isPrivateIpAddress('::ffff:7f00:1'); // true (IPv4-mapped 127.0.0.1)
 * isPrivateIpAddress('93.184.216.34'); // false
 */
export function isPrivateIpAddress(address: string): boolean {
	const normalized = normalizedUrlHostname(address).replace(/%.*$/, '');
	const version = isIP(normalized);

	if (version === 4) return isPrivateIpv4Octets(normalized.split('.').map(Number));
	if (version === 6) return isPrivateIpv6Hextets(expandIpv6(normalized));

	return false;
}

/**
 * Applies the IPv4 reserved-range policy to four parsed octets.
 *
 * @param octets - Parsed IPv4 octets.
 * @returns True when the address belongs to a blocked range.
 */
function isPrivateIpv4Octets(octets: number[]): boolean {
	if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return true;
	}

	const [first, second, third] = octets as [number, number, number, number];

	return first === 0
		|| first === 10
		|| first === 127
		|| (first === 100 && second >= 64 && second <= 127)
		|| (first === 169 && second === 254)
		|| (first === 172 && second >= 16 && second <= 31)
		|| (first === 192 && second === 0 && (third === 0 || third === 2))
		|| (first === 192 && second === 88 && third === 99)
		|| (first === 192 && second === 168)
		|| (first === 198 && (second === 18 || second === 19))
		|| (first === 198 && second === 51 && third === 100)
		|| (first === 203 && second === 0 && third === 113)
		|| first >= 224;
}

/**
 * Applies the IPv6 reserved-range policy to eight expanded hextets.
 *
 * @param hextets - Expanded IPv6 address, or null when it could not be parsed.
 * @returns True when the address belongs to a blocked range.
 */
function isPrivateIpv6Hextets(hextets: number[] | null): boolean {
	if (!hextets) return true;

	const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [number, number, number, number, number, number, number, number];
	const leadingZeros = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;

	// ::ffff:a.b.c.d IPv4-mapped addresses reach the embedded IPv4 host.
	if (leadingZeros && h5 === 0xffff) return isPrivateIpv4Octets(ipv4FromHextets(h6, h7));
	// ::, ::1 and deprecated ::a.b.c.d IPv4-compatible addresses.
	if (leadingZeros && h5 === 0) return true;
	// 64:ff9b::/96 well-known NAT64 prefix translates to the embedded IPv4 host.
	if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
		return isPrivateIpv4Octets(ipv4FromHextets(h6, h7));
	}
	// 64:ff9b:1::/48 local-use NAT64.
	if (h0 === 0x64 && h1 === 0xff9b && h2 === 1) return true;
	// 2002::/16 6to4 embeds the relay's IPv4 address in the next 32 bits.
	if (h0 === 0x2002) return isPrivateIpv4Octets(ipv4FromHextets(h1, h2));
	// 2001::/32 Teredo tunnelling and 2001:db8::/32 documentation.
	if (h0 === 0x2001 && (h1 === 0 || h1 === 0xdb8)) return true;
	// 100::/64 discard-only.
	if (h0 === 0x100 && h1 === 0 && h2 === 0 && h3 === 0) return true;

	return (h0 & 0xfe00) === 0xfc00 // fc00::/7 unique local
		|| (h0 & 0xffc0) === 0xfe80 // fe80::/10 link-local
		|| (h0 & 0xffc0) === 0xfec0 // fec0::/10 deprecated site-local
		|| (h0 & 0xff00) === 0xff00; // ff00::/8 multicast
}

/**
 * Converts two hextets holding an embedded IPv4 address into octets.
 *
 * @param high - Hextet containing the first two octets.
 * @param low - Hextet containing the last two octets.
 * @returns Four IPv4 octets.
 */
function ipv4FromHextets(high: number, low: number): number[] {
	return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

/**
 * Expands a valid IPv6 literal into eight numeric hextets.
 *
 * Supports `::` compression and a trailing dotted IPv4 suffix.
 *
 * @param address - IPv6 literal already validated by `net.isIP`.
 * @returns Eight hextets, or null when the literal cannot be expanded.
 */
function expandIpv6(address: string): number[] | null {
	let value = address;
	const dotted = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);

	if (dotted) {
		const octets = dotted[2]!.split('.').map(Number);
		value = `${dotted[1]}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
	}

	const [head, tail] = value.split('::') as [string, string | undefined];
	const headParts = head ? head.split(':') : [];
	const tailParts = tail === undefined ? [] : tail ? tail.split(':') : [];
	const missing = 8 - headParts.length - tailParts.length;

	if (tail === undefined ? missing !== 0 : missing < 0) return null;

	const hextets = [...headParts, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...tailParts]
		.map(part => Number.parseInt(part, 16));

	return hextets.length === 8 && hextets.every(part => Number.isInteger(part) && part >= 0 && part <= 0xffff)
		? hextets
		: null;
}
