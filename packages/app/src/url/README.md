# Application URLs

## Runnable links and tests

Copy the installed package's `src/url/examples/` into `examples/`, then run
`npx tsx examples/runApplicationLinks.ts`. No SQL or network is needed. The lab
checks base/subpath resolution, invalid configuration, an application-owned
same-origin redirect guard and recovery. Copy the exact
`tests/examples/runApplicationLinks.test.ts` into `tests/url/` to extend it.
`to()` follows standard URL resolution and permits absolute references; it is
not an open-redirect or remote-fetch protection mechanism.

`app().url` is the framework-owned source for the canonical browser-facing
application URL. It is deliberately separate from a concrete server such as
Fastify so URL generation also works in queue workers, schedulers, console
commands, and server-side rendering processes.

Configure a deployed application with `APP_URL` or an explicit `baseUrl`. Apps
with a separate frontend development server can pass its configured local port:

```ts
const application = new App({
	url: {
		localPort: 8888,
	},
});

application.url.baseUrl;
// http://localhost:8888

application.url.to('/api/oauth/callback');
// http://localhost:8888/api/oauth/callback
```

Application code should use this service instead of reading request host
headers or reconstructing origins from environment variables. Request headers
are untrusted and a concrete HTTP server may not exist in background processes.

Future SSR request URLs should be carried by `app().requestContext`; they must
not mutate the canonical URL used for OAuth callbacks, email links, billing
returns, publishing, and background jobs.
