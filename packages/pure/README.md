# @db3.ai/pure

Source-workspace verification uses `npm test --workspace @db3.ai/pure` for tests
plus type checks and available naming checks, or `npm run quality --workspace
@db3.ai/pure` for quality alone. A combined summary reports every stage even
after an ordinary failure. The public source export reports that the
Platform-only naming gate is unavailable; tests and type checks still run.

Environment-independent TypeScript utilities shared by DB3 framework
packages and applications.

## Installation

For a local preview, use the supplied Pure tarball rather than an unpublished
registry version. After installing it, copy `node_modules/@db3.ai/pure/examples/`
into your app's `examples/` and run `npx tsx examples/runNoteTags.ts` with the
development tools from the website's Installation page. It normalizes allowed
tags, rejects an unknown option and recovers with a valid choice. The exact
consumer test is `tests/noteTags.test.ts`; copy it into your app's `tests/`.

The helpers do not replace request validation or authorization. In particular,
`selectedStrings()` reports unknown values in `invalid` but retains them in
`values`. Check `invalid` before saving. These functions do not need an `App`,
database, provider key or HTTP server.

After the first public release, install the utilities with:

```sh
npm install @db3.ai/pure
```

## Publishing status

The staging workflow produces a consumer-verifiable public package artifact,
under the selected MIT license. The target package name is `@db3.ai/pure` and
the configured public source target is `github.com/db3ai/framework`. Neither
metadata nor a successful local package test proves that source and npm versions
are public. Verify npm access, the public repository and trusted-publisher
configuration before publishing. Contributors follow `packages/app/RELEASING.md`.

## Consumer package artifacts

Run `npm run framework:package` and `npm run framework:package:test` from the
repository root. The staged Pure artifact is written to
`dist/framework-packages/pure`; the verification command packs it alongside
App and installs both tarballs in a temporary consumer. The workspace manifest
keeps source exports for monorepo development, while the ordinary staged
manifest exposes compiled JavaScript and declarations under `@db3.ai/pure` and
omits the current private repository identity. Release-mode staging accepts only
the exact dedicated public framework repository, while candidate preparation
requires the checked-in version to match the requested tag. Always prepare Pure
before App. These commands never publish packages.

Once the public GitHub source exists, pass its exact canonical URL with `--repository-url` or
`DB3_FRAMEWORK_REPOSITORY_URL`; that explicit release mode adds repository
metadata and enables npm provenance. See the App package README for the complete
release command.

Dependency-light utilities shared by framework packages and apps.

Use this package for deterministic helpers that should not pull in runtime services:

- strings and display names
- URL helpers
- dates
- records and plain-object helpers
- error normalization
- small auth and HTTP types/helpers
- ULID generation and validation

Do not put database access, request context, queue behavior, mail transports, app models, or product-specific rules here.

Useful check:

```sh
npm run check --workspace packages/pure
```

Promote a helper into this package only when more than one package or app can use it without dragging in backend runtime dependencies.

## Dates and timezones

Import from `@db3.ai/pure/dates`. `utcDate(value)` accepts a valid Date, ISO
instant with an offset, or an ISO/SQL datetime without an offset (interpreted as
UTC). It returns a new Date or null for invalid input. It rejects locale strings
and impossible calendar days. Database fractional seconds beyond milliseconds
are truncated. Use this at UTC persistence boundaries, not to interpret a user's
local scheduling form.

```ts
import { utcDate, formatInTimeZone, calendarDateInTimeZone, validTimeZone } from '@db3.ai/pure/dates';
const instant = utcDate('2026-10-10 13:00:00');
if (!instant) throw new Error('Invalid timestamp');
formatInTimeZone(instant, 'America/New_York'); // 10 Oct 2026, 09:00
calendarDateInTimeZone(instant, 'America/New_York'); // 2026-10-10
validTimeZone('America/New_York'); // validated IANA name
```

Formatting requires an explicit timezone and throws for invalid input. Existing
`formatDate` and `addDays` retain their local-calendar semantics. Date-only
business values should remain calendar dates, not be shifted through timezone
conversion. Store a publishing instant separately from its named timezone;
ISO `Z` output records UTC, not the audience's timezone or recurring local time.

### Temporal and runtime upgrades

Date parsing and timezone conversion use `@js-temporal/polyfill` through the single
internal `src/temporal.ts` adapter. No application should import the polyfill directly.
Public helpers return Date values or strings; their declarations do not expose
polyfill-specific types. The adapter does not patch globalThis. Formatting continues
using the standard `Intl.DateTimeFormat` API.

```ts
import { zonedDateTimeToIso } from '@db3.ai/pure/dates';
zonedDateTimeToIso('2026-10-10T09:00', 'Europe/London'); // '2026-10-10T08:00:00Z'
```

The input is a local ISO date/time without an offset. The default `reject` policy
throws RangeError for nonexistent or repeated local times at daylight-saving changes.
A caller may explicitly select `earlier`, `later` or `compatible`; a scheduling UI
should explain that choice rather than silently moving the user's requested time.

When Node 26 becomes the minimum supported server runtime, change only the internal
adapter to use the native Temporal global and run the same date and packed-consumer
checks against that runtime. Supply native Temporal TypeScript declarations as needed.
Browser support is independent: if browsers still need the polyfill, keep it behind
a browser export condition while the Node entry uses native Temporal. This removes
polyfill loading on Node; the shared package's dependency can only be removed entirely
when browser support is native too, or the browser fallback has its own package.
