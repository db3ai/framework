/**
 * Refuses remote engines because the generated app connects to a loopback DB port.
 *
 * @param {string} host - Docker endpoint, not a password or provider credential.
 */
export function assertLocalDockerHost(host) {
	if (/^(unix|npipe):/.test(host)) return;
	try {
		const url = new URL(host);
		if (['tcp:', 'http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return;
	} catch { /* Invalid endpoints are rejected without echoing their content. */ }
	throw new Error('The Docker starter requires a local Docker engine. Select a local Docker context, or use local MariaDB. No remote containers were started.');
}
