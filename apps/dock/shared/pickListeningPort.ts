/** Lowest port operating systems hand out for `listen(0)` (Linux uses 32768+, macOS 49152+). */
export const EPHEMERAL_PORT_START = 32768;

/**
 * Chooses a process group's main listening port, when its output did not announce one.
 *
 * Processes can also hold incidental listeners on random ports from the
 * operating system's ephemeral range (Crawlee's `proxy-chain` browser proxy, for
 * example), so a port a local proxy (Caddy) maps a domain to wins, then a fixed
 * port below that range, then any port. Every port is still shown; this only
 * picks the one the main link uses.
 *
 * @param ports - Listening ports, in discovery order.
 * @param proxiedPorts - Ports a local proxy forwards a domain to.
 * @returns The main port, or null when nothing listens.
 */
export function pickListeningPort(ports: number[], proxiedPorts: Set<number>): number | null {
	return ports.find(port => proxiedPorts.has(port)) ?? ports.find(port => port < EPHEMERAL_PORT_START) ?? ports[0] ?? null;
}
