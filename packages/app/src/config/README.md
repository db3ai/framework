# Configuration

Read settings once at boot. Parse environment values, validate what your
application needs and pass the result into the services that use it.
`@db3.ai/app/config` supplies `Config`, `defineConfig()`, `env` and `createEnv()`.
It does not discover configuration files or load `.env` for you.

## Run the notes configuration example

Complete the [installation guide](https://db3.ai/docs/installation), including
`tsx`, TypeScript and Vitest. From that independent app directory:

```sh
mkdir -p examples
cp -R node_modules/@db3.ai/app/src/config/examples/. examples/
npx tsx examples/runConfig.ts
APP_PORT=3100 NOTES_PAGE_SIZE=50 APP_DEBUG=yes npx tsx examples/runConfig.ts
```

The default run prints `My notes`, port `3000`, page size `20` and debug `false`.
The override uses port `3100`, page size `50` and debug `true`. A generated URL is
only a value: this lab does not start HTTP, open SQL or contact a provider.
The runner loads `.env` through `dotenv/config`; existing environment variables
take precedence. Keep `.env` out of Git.

Now try an invalid setting:

```sh
APP_PORT=abc npx tsx examples/runConfig.ts
```

It fails with an error naming `APP_PORT` before constructing App. Correct the
value and repeat the command. No partial service startup needs cleaning up.

## Own the application settings

The shipped [loadNotesConfig.ts](./examples/loadNotesConfig.ts) uses
`createEnv(source)` so tests can provide an ordinary object. It validates a
port and page size after parsing them. An integer parser does not know whether
`0` is a valid application port or `100000` is a sensible page size.

Only call `env.required()` when the owning feature needs the value. The example
requires `WEBHOOK_KEY` only when `WEBHOOK_ENABLED` is true. It does not send a
webhook, and it never includes the key in its printed result.

```ts
import { createEnv, defineConfig } from '@db3.ai/app/config';

const env = createEnv({ APP_DEBUG: 'yes', NOTES_PAGE_SIZE: '20' });
const notes = defineConfig({
	debug: env.boolean('APP_DEBUG', false),
	pageSize: env.integer('NOTES_PAGE_SIZE', 20),
});
```

`defineConfig()` preserves inferred types and returns the same object. It does
not validate, freeze or clone it. Import configuration files explicitly; there
is no directory discovery or automatic merge order.

## Wire services explicitly

The shipped [runConfig.ts](./examples/runConfig.ts) passes the settings into
`new App({ config: { notes } })`. The repository becomes `application.config`.
It passes URL settings separately through the supported `url` option.
Putting a value under `config.url` would not configure the URL service.

Use the typed settings object directly where practical. At service boundaries:

```ts
const pageSize = application.config.get<number>('notes.pageSize');
const label = application.config.get('notes.missing', 'fallback');
const present = application.config.has('notes.webhook');
```

The generic in `get<number>()` is a TypeScript assertion, not runtime validation
or checked path autocomplete. See the [App/config guide](https://db3.ai/docs/app-config)
for the distinction between configuration data, service construction and process
startup.

## Presence and defaults

`get(path, fallback)` uses the fallback only when the property is absent.
Existing `null`, `undefined`, `false`, zero and empty strings are preserved.
`has()` checks property presence, not whether the value is truthy.

Paths traverse own object properties. They do not index arrays: retrieve the
whole array and work with it normally. Empty paths and empty path segments such
as `notes..title` throw. A missing intermediate object uses the fallback.

`all()` exposes the original object. Treat configuration as read-only, and never
return `all()` from an endpoint, log it or put it in browser hydration data.

## Environment parsers

| Reader | Behaviour |
| --- | --- |
| `env()` / `env.string()` | Raw string, including an empty string. Fallback applies only to `undefined`. |
| `env.required()` | Rejects missing or exactly empty values. It does not trim whitespace; add domain validation when needed. |
| `env.boolean()` | Case-insensitive `1/true/yes/on` or `0/false/no/off`; rejects other nonempty values. |
| `env.number()` | Converts to a finite number; rejects invalid or non-finite values. |
| `env.integer()` | Also rejects fractional values. Validate application ranges separately. |
| `env.array()` | Comma-separated, trimmed, nonempty entries. |
| `env.json<T>()` | Parses JSON, not a schema. `T` does not validate the parsed shape. |

Typed boolean/number/integer/array/JSON readers trim strings and return their
fallback for missing or empty values. With no fallback the result is
`undefined`. Invalid nonempty input throws rather than silently using a default.

`createEnv()` reads its supplied object on each call. The exported `env` reads
`process.env`. A constructed config object is a snapshot of the values read at
boot; changing environment variables does not recreate an initialized service.
Restart the process after changing settings.

## Testing and cleanup

The website's [Config guide](https://db3.ai/docs/config#testing) supplies the exact
three-test file. Save it as `tests/config/runConfig.test.ts`, keeping the copied
examples in `examples/`, then run:

```sh
npx vitest run tests/config/runConfig.test.ts
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck examples/*.ts
```

It checks defaults, overrides, public output, malformed values, range limits,
optional credentials, fallback/presence and raw versus parsed values. The tests
do not mutate `process.env` or mock framework services. The runner closes App
in `finally`; Config itself owns no handles.

For framework maintainers, the service suite is
`npm run test:service --workspace packages/app -- config --maxWorkers=1`.

## Coverage and advanced reference

The walkthrough exercises typed boot settings, validation, App integration,
Config reuse, safe output and the common parsers. Existing service tests cover
the remaining malformed parser inputs. There is no automatic hot reload,
schema validation, config discovery or secret manager.

The [Config API reference](https://db3.ai/docs/config-api) renders the exact
emitted repository methods and environment-reader overloads from the staged
package. Application types and permissions remain in your app.
