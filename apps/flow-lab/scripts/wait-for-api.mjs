const timeoutMs = positiveInteger(process.env.FLOW_LAB_DEV_SERVER_READY_TIMEOUT_MS, 60_000);
const startedAt = Date.now();
const healthUrl = serverHealthUrl();

console.log(`Waiting for Flow Lab API at ${healthUrl}.`);

while (Date.now() - startedAt < timeoutMs) {
	if (await serverIsHealthy()) {
		console.log('Flow Lab API is ready; starting queue worker.');
		process.exit(0);
	}

	await delay(500);
}

console.error(`Flow Lab API did not become ready at ${healthUrl} within ${timeoutMs}ms.`);
process.exit(1);

/**
 * Checks whether the local Flow Lab API answers its health endpoint.
 *
 * @returns True when the health endpoint responds successfully.
 */
async function serverIsHealthy() {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 1000);

	try {
		const response = await fetch(healthUrl, {
			signal: controller.signal,
		});

		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Builds the loopback health URL from Flow Lab environment variables.
 *
 * @returns Local API health URL.
 */
function serverHealthUrl() {
	const port = process.env.FLOW_LAB_API_PORT || process.env.PORT || '8788';
	const host = process.env.FLOW_LAB_API_HOST || process.env.HOST || '127.0.0.1';
	const probeHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;

	return `http://${httpHost(probeHost)}:${port}/api/health`;
}

/**
 * Wraps IPv6 hosts for use in HTTP URLs.
 *
 * @param {string} host - Host name or address.
 * @returns {string} URL-safe host.
 */
function httpHost(host) {
	if (host.includes(':') && !host.startsWith('[')) return `[${host}]`;

	return host;
}

/**
 * Parses a positive integer with a fallback.
 *
 * @param {string | undefined} input - Raw environment value.
 * @param {number} fallback - Value used when parsing fails.
 * @returns {number} Safe positive integer.
 */
function positiveInteger(input, fallback) {
	if (!input) return fallback;

	const value = Number(input);

	if (!Number.isFinite(value) || value <= 0) return fallback;
	return Math.trunc(value);
}

/**
 * Resolves after a development polling delay.
 *
 * @param {number} milliseconds - Delay duration.
 * @returns {Promise<void>} Promise resolved after the delay.
 */
function delay(milliseconds) {
	return new Promise(resolve => {
		setTimeout(resolve, milliseconds);
	});
}
