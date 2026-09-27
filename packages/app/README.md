# @db3.ai/app

Shared backend framework package for DB3 applications.

The framework is intended to support both code-first and visual application
development. Framework operations should expose reusable contracts so CLI,
GUI, programmatic, and collaborative AI clients can share the same behavior
rather than creating parallel implementations. Source-repository contributors
can read the product direction in `docs/framework-goals.md`; that repository-only
document is not part of the installed runtime package.

This package owns reusable runtime services and data-layer mechanics:

- `apps`: local feature apps, optional public services, owned migrations, lifecycle and inspectable navigation metadata. See [Apps](src/apps/README.md) for local folders and npm extraction.

- `config`: explicit config repositories and environment parsing helpers.
- `cli`: shared `db3` commands, interactive app REPL, service registration, help and app lifecycle.
- `cache`: named cache stores and driver-backed value lifecycles.
- `events`: synchronous and asynchronous in-process event dispatch.
- `health`: extensible application and component checks with a Fastify `/health` adapter.
- `websocket`: public/authenticated JSON endpoint actions, server-owned local channels, presence and a small browser client; see [WebSocket setup](./src/websocket/README.md).
- `logging`: structured application logging and development-tool delivery.
- `server`: `App`, service discovery, request context, and database wiring.
- `db`: ActiveRecord, FieldType, projections, schema installation, and SQL error helpers.
- `validation`: request-data validation for routes, services, and jobs.
- `auth`: user identity, configurable auth providers, auth tokens, password reset tokens, and password hashing.
- `ai`: agents with function calls, streaming, durable conversations, provider request tracking, images, embeddings, structured output and failover.
- `queue`: database-backed dispatch, handlers, job classes, retry/failure records, and workers.
- `serialization`: registered root-constructor serialization from ordinary JSON state, with ActiveRecord identity references as the only special nested value.
- `scheduler`: code-owned daily schedules, durable occurrence claims, queue correlation, and a dedicated worker.
- `flows`: code-backed graph definitions, queue orchestration, durable block observability, nested flows, and replay.
- `mail`: file, Mailgun, and Resend mail transports.
- `in-app`: durable recipient inboxes, scoped access, deduplication and independent read/dismiss/archive state.
- `notifications`: recipient-aware `via()`, `toInApp()` and `toMail()` definitions coordinated through framework delivery services.
- `storage`: named local and S3-compatible disks, streams, transfers and scoped file operations.
- `media`: scoped media libraries, managed file ULIDs, and browser-visible folder trees.
- `network`: outbound request guards that keep user-supplied URLs, redirects and headless-browser traffic off private networks; see [Network](./src/network/README.md).
- `security`: central key configuration and versioned authenticated encryption for application secrets.
- `ssr`: optional render contracts, document assembly, safe hydration state, and Fastify adaptation for public HTML.
- `url`: canonical base-URL configuration and standard URL resolution, without a named-route registry.

Keep app-specific behavior in `apps/*`. Move code here only when it is reusable framework behavior.

## Installation

After the first public release, install the framework runtime with:

```sh
npm install @db3.ai/app
```

Install optional Fastify or Vite peer packages only when using their matching
SSR adapters.

## Publishing status

The framework is MIT licensed; private applications sharing the development
repository are excluded by the licence scope. Public framework source belongs
in `github.com/db3ai/framework`. The published packages are `@db3.ai/app`,
`@db3.ai/pure` and `@db3.ai/create`. Maintainers can publish a verified beta from
the repository root with `npm run framework:publish -- --version 0.1.0-beta.1`;
add `--dry-run` to inspect it without publishing. npm handles packaging, login
and upload. See `docs/framework-release.md` for release checks and the manual
bootstrap and trusted-publishing workflows.

The [installation guide](https://db3.ai/docs/installation) distinguishes the
unpublished preview tarballs from the future npm install command. The
[first app](https://db3.ai/docs/create-app) uses the shipped
`src/server/examples` files to run and test an independent Fastify application.
Auth, Storage, Media and Scheduler also ship their service-owned examples.

## Consumer package artifacts

From the repository root, stage both compiled packages and run the clean
consumer install gate with:

```sh
npm run framework:package
npm run framework:package:test
```

The first command writes publish-shaped packages to
`dist/framework-packages/pure` and `dist/framework-packages/app`. The second
packs both directories, installs the tarballs in a temporary project, imports
every public runtime subpath, type-checks representative declarations, verifies
installed Markdown links, and exercises the `db3-agents` scaffold.

The workspace manifests intentionally keep their source exports for monorepo
development; only the staged manifests target compiled JavaScript and
declarations. Workspace manifests, runtime imports, examples, documentation,
and consumer artifacts all use the same `@db3.ai/*` package names.
The ordinary staged manifest omits the private monorepo repository identity.
Release-mode staging requires the exact dedicated public framework repository
and rejects ambiguous or non-GitHub URLs. Candidate preparation also requires
both checked-in versions and App's exact Pure dependency to match the requested
tag; it does not rewrite versions. Always prepare Pure before App because App
depends on the matching Pure version. These commands do not publish either
package.

npm provenance requires a public repository whose package `repository.url`
matches the GitHub source exactly. Once that repository is established, publish
from its trusted GitHub Actions workflow so npm can attach provenance without a
long-lived publish token.

The eventual public workflow must supply its exact canonical source URL through
either the option or environment variable below:

```sh
npm run framework:package -- --repository-url git+https://github.com/OWNER/REPOSITORY.git
DB3_FRAMEWORK_REPOSITORY_URL=git+https://github.com/OWNER/REPOSITORY.git npm run framework:package
```

Only canonical public GitHub URLs are accepted. In this explicit release mode,
the staged manifests include package-directory repository metadata and enable
`publishConfig.provenance`; neither command publishes a package.

## AI application guidance

Generated DB3 applications include a root `AGENTS.md` that tells AI coding
tools to resolve the installed framework instructions, use public package
exports, preserve application/framework ownership, and follow the framework's
file-naming conventions. In particular, class-owning TypeScript files and Vue
components use PascalCase and match their primary concept.

Existing applications can add the marked framework block without replacing
their product-specific instructions:

```sh
npx db3-agents --target AGENTS.md
```

Refresh only that framework-owned block after upgrading `@db3.ai/app`:

```sh
npx db3-agents --target AGENTS.md --update
```

The scaffold directs AI tools to the installed
`@db3.ai/app/agent-instructions` export. Those installed instructions are the
consumer-facing source of truth for application layout, boundaries, naming,
and verification.

## Testing

In the source workspace, `npm test --workspace @db3.ai/app -- <optional test paths>`
runs the selected behaviour tests, then source/example type checks and available
workspace naming checks. All stages run after ordinary failures and a combined
summary reports the final result and the convention findings path.
`npm run quality --workspace @db3.ai/app` runs the same quality stages without
tests. The Platform naming gate is not included in the public source export;
the runner explicitly reports its absence there. The specialised service and
coverage commands below remain available for iteration and release workflows.

Framework tests live with the service they exercise under
`src/{service}/tests`. Run the complete package suite before considering a
framework change finished:

```sh
npm run check --workspace packages/app
npm test --workspace packages/app
```

Run one service while developing a focused change by passing its directory
name to the service runner:

```sh
npm run test:service --workspace packages/app -- queue
```

The service runner fails when the service does not have a test directory, so a
misspelled or stale service name cannot produce an accidental green result.
Coverage uses the same complete suite and enforces package-wide regression
floors of 75% statements, 65% branches, 80% functions, and 77% lines:

```sh
npm run test:coverage --workspace packages/app
```

The test scripts optionally load connection credentials from the package-owned
`packages/app/.env.test` file, then force `NODE_ENV=test`,
`DB_DATABASE=db3_app_test`, and `DB_TEST_DATABASE_PREFIX=db3_app_test`.
Start from the committed example when local credentials are needed:

```sh
cp packages/app/.env.test.example packages/app/.env.test
```

Framework integration suites create and remove unique disposable databases
under that test-only namespace. They do not read application configuration or connect
to an application's named database. A `DATABASE_URL` supplied by CI must itself
target `db3_app_test` (or a disposable database with that prefix). The configured
database server must be reachable for the complete suite and service suites that
own database integration tests.

Redis Queue integration tests use `QUEUE_REDIS_URL` or the separate
`QUEUE_REDIS_HOST` and `QUEUE_REDIS_PORT` settings. They skip during an ordinary
local run when Redis is unavailable. A release gate must prove the Redis driver
against a real server and fail instead of skipping it:

```sh
npm run test:release --workspace packages/app
```

The release command runs the source and example type checks followed by the
complete coverage suite. It sets `TEST_REDIS_REQUIRED=1`, so an unreachable
Redis server is a failure rather than a conditional skip.

Tests should exercise public typed contracts and observable behaviour with real
framework components. Mock only external provider boundaries, and cover failure,
retry, cleanup, and lifecycle behaviour when those outcomes are part of the
service contract. Public API changes also require a consumer type check through
the exported package subpath; importing a private source file is not sufficient.
When a service supports multiple drivers, apply the same behavioural contract to
each supported driver where practical, and require its external infrastructure
in the release gate instead of accepting a skipped suite as proof.

The richer guide at [db3.ai](https://db3.ai/) includes dedicated sections for
Mail, Queue, creating jobs, and queue workers.

See [src/cli/README.md](./src/cli/README.md) for the shared `db3` executable and
service command registration. Generated apps configure it in `server/cli.config.ts`;
database commands are owned by DB and job generation is owned by Queue.

See [src/flows/README.md](./src/flows/README.md) for flow definitions, block contracts, file providers, durable run models, nested execution, and replay.

See [src/scheduler/README.md](./src/scheduler/README.md) for scheduled jobs,
inline calls, durable deduplication, occurrence history, and process commands.

See [src/serialization/README.md](./src/serialization/README.md) for
`app().serializer`, registry configuration, supported values, and ActiveRecord
reference semantics.

See [src/security/README.md](./src/security/README.md) for `app().security`,
application-key configuration, authenticated encryption, and encrypted JSON
model fields.

See [src/ssr/README.md](./src/ssr/README.md) for the optional server-rendering
boundary, document markers, request isolation, and Fastify adapter.

## Auth Providers

`packages/app/src/auth` treats the user row as the account and `auth_providers`
rows as the ways that account can authenticate. Provider-specific code lives in
`packages/app/src/auth/providers`: the built-in `password` provider stores
password credentials in `auth_providers`, while the Google provider verifies
Google ID tokens and stores only safe profile claims.

Apps configure supported providers through the app config repository at
`auth.providers`:

```ts
import {
	GOOGLE_AUTH_PROVIDER,
	PASSWORD_AUTH_PROVIDER,
} from '@db3.ai/app/auth';

const app = new App({
	config: {
		auth: {
			providers: {
				[PASSWORD_AUTH_PROVIDER]: {
					driver: PASSWORD_AUTH_PROVIDER,
				},
				[GOOGLE_AUTH_PROVIDER]: {
					driver: GOOGLE_AUTH_PROVIDER,
					clientIds: ['google-client-id.apps.googleusercontent.com'],
				},
			},
		},
	},
});
```

Tests and advanced apps may also pass concrete provider driver instances through
`AppOptions.auth.providers`.

Provider rows can be listed, linked, and unlinked through the auth service. The
framework refuses to unlink the final provider for a user so every account keeps
at least one usable login method.

See [src/auth/README.md](./src/auth/README.md) for the account/provider mental
model, route and session examples, provider management, custom drivers, security
responsibilities, and complete password and Google setup instructions.

See [src/in-app/README.md](./src/in-app/README.md) for `app().inApp`, storage setup, authenticated inbox operations and the current delivery boundary.

See [src/notifications/README.md](./src/notifications/README.md) for notification classes, multi-channel sends and durable-job retry responsibilities.
