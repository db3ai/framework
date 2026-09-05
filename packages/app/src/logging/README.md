# Logging

`@db3.ai/app/logging` provides the application logger exposed through
`app().log`. Pino is the default driver, while the framework owns service discovery,
configuration, redaction, transport selection, and shutdown.

## Run a structured logging lab

From your independent app after [Installation](https://db3.ai/docs/installation):

```sh
mkdir -p examples
cp -R node_modules/@db3.ai/app/src/logging/examples/. examples/
npx tsx examples/runNoteLogs.ts
```

This captures the real Pino driver's output in a writable stream, with devtools HTTP delivery disabled. Expect three records: `Note saved`, `Summary failed`, and `Diagnostics enabled`. The first debug message is filtered, then changing `log.level` enables debug output. Changing it to silent suppresses later errors. The output omits unstable metadata and stack text only for readability.

The [Logging guide](https://db3.ai/docs/logging#testing) contains the exact consumer test. Save it as `tests/logging/runNoteLogs.test.ts` and run:

```sh
npx vitest run tests/logging/runNoteLogs.test.ts
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck examples/*.ts
```

The test asserts structured context, error serialization, level changes and the absence of synthetic password/token/provider-key values. It uses the real logger, not a framework mock. This does not prove remote log ingestion or retention.

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
- `PLATFORM_LOG_DEVTOOLS`: explicitly enables or disables devtools delivery.
- `PLATFORM_DEVTOOLS_EVENTS_URL`: complete development ingestion endpoint.
- `PLATFORM_DEVTOOLS_HOST`: development service host when no URL is supplied.
- `PLATFORM_DEVTOOLS_API_PORT`: development service port, defaulting to `9998`.

Newline-delimited JSON is written to standard output by default. Interactive
development also enables the framework devtools transport automatically. Tests
do not enable network delivery unless explicitly configured.

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
