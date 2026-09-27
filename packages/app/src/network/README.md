# Network

The network service protects outbound requests whose destination comes from a
user, a crawled page or a redirect. It stops those requests from reaching the
server's own network: loopback, private ranges, link-local cloud metadata
endpoints, and other reserved addresses.

Use it whenever an application fetches a URL it did not choose itself, such as
webhook deliveries, link previews, crawlers, feed imports or screenshot tools.
Requests to fixed, trusted provider APIs do not need it.

## Fetch a user-supplied URL

```ts
import { BlockedUrlError, guardedFetch } from '@db3.ai/app/network';

try {
	const { response, finalUrl } = await guardedFetch(input.url, {
		init: { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(10_000) },
	});
	// Use response and finalUrl as with fetch.
} catch (error) {
	if (error instanceof BlockedUrlError) {
		// error.message is safe to show to the user who supplied the URL.
	}
	throw error;
}
```

`guardedFetch` returns a normal `Response`. It:

- validates the URL and every redirect target before requesting it;
- checks the address DNS returns **when the socket connects**, so a hostname
  cannot pass validation and then resolve to a private address (DNS rebinding);
- follows redirects like `fetch`: `303`, and `301`/`302` after `POST`, switch
  to `GET` without a body, and `Authorization`/`Cookie` headers are removed
  when a redirect leaves the original origin;
- stops after `maxRedirects` (default 4), or returns the first redirect
  unfollowed with `redirect: 'manual'`.

It sends requests with the runtime's global `fetch`, so tests that replace
`globalThis.fetch` keep working.

## Local development

Pass `allowPrivate: true` to reach private hosts, for example a webhook
receiver on `http://localhost:8100`. TLS certificate verification remains enabled
for every HTTPS destination. Configure a trusted local CA for development HTTPS;
allowing a private address does not authorize an unverified server certificate.
Decide address policy in application configuration (for example only when
`NODE_ENV=development`) and never from request input.

## Other HTTP clients

- `assertPublicUrl(url, options)` performs the pre-flight check and throws
  `BlockedUrlError`. Call it for the first URL and for every redirect target.
- `publicAddressLookup` has the signature of `dns.lookup`. Pass it as the
  `lookup` socket option (Node `http`/`https`, undici `connect.lookup`, got
  `dnsLookup`) so the connected address is checked. Node does not call `lookup`
  for IP-literal hosts, which is why redirect targets also need
  `assertPublicUrl`.
- `isPrivateIpAddress`, `isPrivateHostname` and `normalizedUrlHostname` expose
  the address policy for custom checks.

## Headless browsers

Browsers make their own requests for redirects, frames, scripts and images.
The optional `@db3.ai/app/network/playwright` entry point requires Playwright
and Chromium. It gives each context an authenticated loopback proxy that checks
every HTTP destination and HTTPS CONNECT tunnel, including connect-time DNS.
Chromium's implicit loopback bypass is disabled. Callers cannot override the proxy.

```ts
import { chromium } from 'playwright';
import { newGuardedBrowserContext } from '@db3.ai/app/network/playwright';

const browser = await chromium.launch({
	args: ['--force-webrtc-ip-handling-policy', '--webrtc-ip-handling-policy=disable_non_proxied_udp'],
});
try {
	const context = await newGuardedBrowserContext(browser, {}, {
		blockedResourceTypes: ['font', 'media'],
		onBlocked: ({ url }) => console.warn('Blocked', url),
	});
	try {
		const page = await context.newPage();
		await page.goto(input.url);
		const screenshot = await page.screenshot();
	} finally {
		await context.close();
	}
} finally {
	await browser.close();
}
```

Redirects, cookie storage, origins and TLS certificate verification stay native to
Chromium. The proxy streams HTTP bodies without collecting them in memory and
handles interrupted streams as ordinary network failures. `requestTimeoutMs`
sets socket inactivity timeout (30 seconds by default). Closing a context closes
its listener and all in-flight proxy sockets. Setup failures also clean up.

Service workers and WebSockets are disabled. WebRTC is not HTTP traffic, which is
why the Chromium launch flags above remain necessary for untrusted pages.
`allowPrivate` permits local destinations but does not disable Chromium TLS
verification; explicit `ignoreHTTPSErrors` is a separate browser option. Run these
workers behind a network egress policy as an additional infrastructure boundary.

## Address policy

Blocked destinations include `localhost` names, `0.0.0.0/8`, `10.0.0.0/8`,
`100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`,
`192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`,
`198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0` and above,
IPv6 loopback, unique-local, link-local, site-local, multicast, documentation,
Teredo and discard ranges, and IPv4-compatible addresses. IPv4-mapped, NAT64
(`64:ff9b::/96`) and 6to4 (`2002::/16`) addresses are judged by the IPv4 address
they embed.

## Run the example

```sh
npx tsx node_modules/@db3.ai/app/src/network/examples/runGuardedFetch.ts
```

Expect `privateBlockedByDefault` and `privateAllowedWhenRequested` to be true.

## Dependencies

Uses `undici` 7 for the connection dispatcher, which is compatible with the
global `fetch` bundled with supported Node versions. The Playwright entry point
depends on the optional `playwright` peer dependency. The service has no
framework service dependencies.
