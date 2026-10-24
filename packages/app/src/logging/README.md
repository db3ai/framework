# Logging

`app().log` uses Pino; the framework owns configuration, redaction, transports and shutdown.

## Writing logs

Use structured context and put exceptions under `err` to retain name, message, stack and cause:

```ts
app().log.error({ err: error, websiteId }, 'Website crawl failed');
const log = app().log.child({ component: 'crawler', websiteId });
log.info('Crawl started');
```

Levels are `trace`, `debug`, `info`, `warn`, `error`, `fatal` and `silent`.
The default is `info`, or `silent` in tests. Application boundaries must log exceptions explicitly.

## Configuration

```ts
const app = new App({
	log: {
		level: 'info',
		source: 'example-api',
		bindings: { release: process.env.RELEASE_SHA },
		transports: [
			{ type: 'console' },
			{ type: 'file', destination: '/storage/logs/app.jsonl' },
			{ type: 'email', level: 'error', to: 'operator@example.com' },
		],
	},
});
```

`transports` replaces defaults; `[]` disables output. Omit it for legacy/environment
defaults. Route thresholds combine with the logger minimum; email defaults to `error`,
others inherit it. `silent` disables a route. Pino permits one console and devtools via
`{ type: 'devtools', options: { url } }`.

Environment defaults: `PLATFORM_LOG_LEVEL`, `PLATFORM_LOG_SOURCE`, `PLATFORM_LOG_FORMAT`
(`auto`, `pretty`, `json`), `PLATFORM_LOG_FILE`, `PLATFORM_LOG_DEVTOOLS`,
`PLATFORM_DEVTOOLS_EVENTS_URL`, `PLATFORM_DEVTOOLS_HOST`, `PLATFORM_DEVTOOLS_API_PORT` (9998).
Legacy `log.file` adds a file alongside stdout unless `console: false`.

Terminals show pending requests and grouped exchanges; production/tests/pipes use JSON.
`consoleFormat` overrides presentation. Files/devtools stay structured; test devtools
requires opt-in. See [development logging](development/README.md).

## Email

Every matching record, including repeats, gets a separate submission through `app.mail`.
Logging formats redacted primitive context and exception message/stack/cause as text and
escaped HTML, excluding arbitrary nested payloads. Common credentials are masked.
There is no grouping, deduplication, cooldown, retry or database dependency.
Operation backoff remains the caller's responsibility.

Ordered async mail: 100 pending (`maxPending`), 60 accepted/min (`maxPerMinute`)
by default. Other logs retain excess; flush reports suppressed email counts to
stderr. Flush/close drains accepted mail. Abrupt exits lose pending mail. Refusals go to stderr without recursive emails; later sends continue. Keep raw logs:
acceptance is not inbox delivery. App supplies the lazy Mail resolver accepted by `Log`.
Database, PostHog and OpenTelemetry transports are not included.

## Delivery and shutdown

Devtools sends worker-thread HTTP batches to `/api/events`: at most 25 records per batch,
100ms partial-batch wait, 1,000 pending events. Overflow drops oldest events; failed batches
are discarded and delivery pauses one second. Its event store feeds the Logs panel.

`App.close()` flushes logging and closes owned workers; use it instead of immediate
`process.exit()`. Caller-supplied streams remain caller-owned. File transports create parent
directories; mount files persistently and manage rotation, retention, permissions and capacity.
`Log.level` changes affect subsequent method lookups, not previously captured functions.

## Security and boundaries

Pino removes common credential, authorization and cookie paths. Add paths with `log.redact`;
`false` disables protection. Path redaction cannot remove arbitrary secret substrings,
private prose or unfamiliar nested fields. Avoid sensitive messages, URL queries and bodies;
log explicit safe fields and test application-specific redaction.

Logs must not trigger application behavior. Database, queue and flow events keep their
own typed contracts; correlate them using request/job/website/flow IDs and component fields.
See the [API](https://db3.ai/docs/logging-api) for contracts.

## Custom transports

Use `{ type: 'custom', level: 'error', create: () => new MyTransport(options) }`
for provider destinations. The exported `LogTransport` contract receives complete
Pino JSON lines after redaction, including child bindings and serialized exceptions.
The factory runs lazily when the logger is constructed, once per logger; silent
routes do not construct a destination. Removing the entry disables the provider.
The logger owns flush and optional close. Implement bounded delivery buffering and
timeouts in the transport. Write/flush/close failures report a generic stderr diagnostic
and do not suppress other destinations; factory errors fail logger construction.
Provider SDKs and credentials remain in the consuming application or provider package.
See [the runnable custom transport example](examples/runNoteLogs.ts).
