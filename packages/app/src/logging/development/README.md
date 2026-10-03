# Development logging

Development terminals show a small live waiting area immediately on request arrival.
Completed requests move into permanent blocks in completion order, paired by
process, source and request ID. Each block contains method, URL, status, duration
and readable request/response bodies when capture is enabled:

```text
14:50:00 [http] POST → /api/v1/user  201 Created · 842 ms  #req-1
  > request
    {"user":1234}
  < response
    {"id":1234,"created":true}
```

The waiting area displays elapsed time, labels requests slow after five seconds,
and shows at most five rows. It contracts on narrow terminals. Timeouts,
disconnects and process shutdown produce explicit terminal outcomes. Up to 1,000
pending requests retain context; eviction is reported and later responses still
print. Normal console/stdout/stderr messages in the same process appear above
pending rows. Closing the last logger restores the original stream methods,
removes timers/listeners and clears the waiting area without clearing history.

Install the shared capture adapter **before routes** on a Fastify server using
`app().log.logger` as its `loggerInstance`:

```ts
import { registerHttpExchangeMonitor } from '@db3.ai/app/logging';

registerHttpExchangeMonitor(server, {
	exclude: request => request.url.startsWith('/private-reports/'),
});
```

The adapter only captures in development. `enabled: false` disables capture;
`maxBodyBytes` defaults to 16 KiB and is capped at 64 KiB per body. Credential
fields are recursively redacted. Streams and binary bodies show metadata and
are never consumed for logging. Exclusion controls body/header capture; disable
route logging separately if even its URL must not appear. Existing JSON and
devtools destinations retain the captured records.

Small JSON values stay inline; larger values are indented. Terminal previews
show at most 20 lines and 160 characters per line, with explicit omission markers.
Errors retain bounded stacks and causes. Headers and routine process metadata
stay out of the terminal presentation. Complete *captured* details remain in
configured JSON files and devtools; capture limits still apply there.

Production, tests and redirected/piped stdout keep newline-delimited JSON.
Override this with `log: { consoleFormat: 'pretty' }` or
`PLATFORM_LOG_FORMAT=pretty`; use `json` for raw records. Explicit app options take
precedence. `auto` restores environment/terminal detection. `NO_COLOR` or
`FORCE_COLOR=0` disables colours; `TERM=dumb` disables live redraws. Explicit
pretty output to a pipe is append-only. Files and devtools remain structured.

For a multi-process launcher, create **one** `DevelopmentConsole` from
`@db3.ai/app/logging`, pipe each child's stdout/stderr into separate
`console.createInput()` streams, and set child `PLATFORM_LOG_FORMAT=json`.
Call `endSource(child.pid)` after a direct child closes, then `close()` and
`await flush()` when all streams finish. The renderer cannot coordinate another
process writing directly to the same terminal. It does not close caller-owned
streams. Do not create a separate renderer for each child.

The shipped `examples/runDevelopmentLogs.ts` demonstrates concurrent requests,
payloads and interleaved client output without opening a listening socket.
Interactive development also enables the devtools transport automatically;
tests only enable network delivery when explicitly configured.


## Structured logging lab

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
