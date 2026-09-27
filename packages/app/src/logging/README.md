# Logging

`@db3.ai/app/logging` provides the application logger exposed through
`app().log`. Pino is the default driver, while the framework owns service discovery,
configuration, redaction, transport selection, and shutdown.

## Writing Logs

Prefer a short message plus structured fields:

```ts
app().log.info({
	websiteId,
	pageCount,
}, 'Website crawl completed');
```

Pass errors under `err` so Pino retains their name, message, stack, and cause:

```ts
app().log.error({
	err: error,
	websiteId,
}, 'Website crawl failed');
```

Use child loggers for context shared by several records:

```ts
const log = app().log.child({
	component: 'crawler',
	websiteId,
});

log.info('Crawl started');
log.debug({ url }, 'Page discovered');
```

The standard levels are `trace`, `debug`, `info`, `warn`, `error`, `fatal`,
and `silent`. The default level is `info`; tests default to `silent`.

## Application Configuration

Configure logging through `AppOptions.log`:

```ts
const app = new App({
	log: {
		level: 'debug',
		source: 'example-api',
		bindings: {
			release: process.env.RELEASE_SHA,
		},
		devtools: true,
	},
});
```

Supported environment values:

- `PLATFORM_LOG_LEVEL`: minimum standard log level.
- `PLATFORM_LOG_SOURCE`: source name copied to every record.
- `PLATFORM_LOG_FORMAT`: console presentation: `auto`, `pretty`, or `json`.
- `PLATFORM_LOG_DEVTOOLS`: explicitly enables or disables devtools delivery.
- `PLATFORM_DEVTOOLS_EVENTS_URL`: complete development ingestion endpoint.
- `PLATFORM_DEVTOOLS_HOST`: development service host when no URL is supplied.
- `PLATFORM_DEVTOOLS_API_PORT`: development service port, defaulting to `9998`.

Development terminals show live pending requests and grouped request/response
blocks. Production, tests and pipes keep structured JSON. `consoleFormat` or
`PLATFORM_LOG_FORMAT` selects `auto`, `pretty` or `json`; files/devtools stay
structured. See the [development logging guide](development/README.md) for payload
capture, preview limits, terminal lifecycle, multi-process launchers and runnable
examples. Tests only enable devtools network delivery when explicitly configured.

## Development Log Stream

The Pino transport runs in a worker thread and sends bounded, best-effort HTTP
batches to the same generic event endpoint used by database and queue
instrumentation:

```text
app().log
	-> Pino worker transport
	-> POST /api/events
	-> development event store
	-> WebSocket
	-> Logs panel
```

The default batch contains at most 25 records and a partial batch waits at most
100 milliseconds. At most 1,000 unsent events are retained; the oldest event is
discarded when that bound is exceeded. A failed batch is discarded and later
delivery pauses for one second. Logging therefore remains observability rather
than an application dependency.

`App.close()` flushes the logger and closes its worker transport. Application
entrypoints should always use the framework shutdown lifecycle rather than
calling `process.exit()` directly after writing a log.

## Security

The default Pino driver removes common password, secret, token, authorization,
and cookie paths before records reach stdout or devtools. Applications can add
more redaction paths through `AppOptions.log.redact`.

Redaction is a safeguard, not permission to log request bodies, credentials,
payment details, or personal data. Prefer explicit safe fields over logging
large application objects.

Redaction removes configured paths, not arbitrary secret substrings. Error messages, URL query strings and unfamiliar nested properties may still contain sensitive data. Test your application paths and never embed a credential in the log message itself. `redact: false` disables the protection.

`Log.level` changes take effect on subsequent method lookups; avoid capturing a log function and then expecting it to be replaced when the level changes. `App.close()` owns its logger; a manually supplied output stream remains the creator's resource to end. The [full API](https://db3.ai/docs/logging-api) includes all current logger, driver, options and HTTP exchange contracts.

## Framework Boundaries

Logs describe operations for people and observability tools. They are not a
framework event bus and must not trigger application behavior.

Database query events, queue lifecycle events, and durable flow events retain
their own typed contracts. They can be correlated with logs through fields such
as `requestId`, `jobId`, `websiteId`, `flowId`, and `component`.

## Persistent JSON files

Set `log.file` or `PLATFORM_LOG_FILE` to append the same redacted JSON records to
a persistent file, in addition to stdout unless `console: false`. Parent
directories are created by the Pino file transport. `App.close()` flushes and
closes the transport. Mount the destination outside ephemeral containers and
configure rotation, retention, permissions and capacity monitoring externally.
