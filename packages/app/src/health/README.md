# Health

`@db3.ai/app/health` provides a small application health registry. It owns the
safe aggregate result while concrete HTTP adapters expose it to load balancers,
deployment gates and uptime monitors.

Every `App` has an `app().health` service with an `application` check, so a new
application can expose `/health` without defining custom checks. Applications
extend the report with stable names:

```ts
import { databaseHealthCheck } from '@db3.ai/app/health';

application.health
	.register('database', databaseHealthCheck(application.db))
	.register('search-provider', async () => ({
		status: providerConfigured ? 'ok' : 'degraded',
		message: providerConfigured ? undefined : 'Optional search features are unavailable.',
	}));
```

Checks run concurrently with a three-second per-check timeout by default. A thrown value becomes a generic unhealthy result and
does not leak its error message through the public endpoint. Log private details
inside the application check when an operator needs them.

## Fastify

Register the canonical endpoint from `@db3.ai/app/health/fastify`:

```ts
import { registerHealthRoute } from '@db3.ai/app/health/fastify';

registerHealthRoute(server, {
	app: application,
	path: '/health',
	aliases: ['/healthz'],
});
```

The endpoint returns `200` for `ok` and `degraded`, `503` for `unhealthy`, and
always sends `Cache-Control: no-store`. `/health` is the recommended public path;
aliases exist only for compatibility with existing infrastructure.

Health is deliberately narrower than telemetry. It answers whether this process
should receive traffic now. Metrics, traces and logs explain performance and
incidents over time.
