# @db3.ai/app Agent Instructions

This file is the installed framework guide for AI tools working in a consuming
application. The consuming repository's `AGENTS.md` should route framework work
here; this file does not replace the application's own product instructions.

## Resolve the installed framework

Use Node's package resolver instead of assuming a particular `node_modules`
layout:

```sh
node -p "require.resolve('@db3.ai/app/agent-instructions')"
```

The returned file is inside the installed `@db3.ai/app` package. Resolve the
other paths below relative to its directory.

## Read the smallest relevant surface

- Read `package.json` for supported public entry points.
- Read `README.md` for package ownership and application setup.
- For one service, read `src/{service}/README.md` when it is shipped.
- Use the declarations exposed by the relevant `@db3.ai/app/{service}` entry
  point as the exact public API contract.
- Use service-owned examples under `src/{service}/examples/` when present.

Do not infer supported APIs from unexported files or copy implementation details
from `node_modules` into the application. If the installed declarations,
documentation and runtime disagree, treat that as a framework defect and record
the installed package version.

## Application boundaries

- For new applications, use `client/` for browser code and `server/` for backend
  code. Keep committed migrations and the schema snapshot in `server/database/`,
  and behaviour tests in `tests/`. Browser database access goes through the server API.
- Configure app migrations with `dbOptions: { migrations: { models } }`.
  The framework fixes paths to `server/database/migrations/` and
  `server/database/schema.snapshot.json` beneath `App.directory`; no separate
  `migrations.ts` configuration is needed. The starter anchors the app root with
  `directory: new URL('../', import.meta.url)` in `server/app.ts`.
- Register service commands in `server/cli.config.ts` using the shared `db3` CLI.
  Keep command implementations in their owning service and reuse its public operations.
- Keep product models, routes, jobs and policy in the consuming application.
- Define new models with `class ModelName extends ActiveRecord.define({ table,
  fields: field => ({ id: field.ulid(), ... }) }) {}` imported from
  `@db3.ai/app/db`. Put schema options in the definition and methods in the class
  body. Do not repeat inferred fields with `declare` properties or widen the
  factory return type. Use `field.json<Shape>()` for structured values and handle
  inferred nullability; `required: true` is runtime validation. `create()` makes
  an unsaved record; persist it with `save()`. Register models in the owning
  migration registry and generate committed migrations when the schema changes.
- Use ActiveRecord logical field names and let fields own database mapping,
  conversion, validation and JSON values.
- Resolve normal application services through the active `App` rather than
  threading optional Knex connections through app code.
- Put reusable mechanics in the framework only when they are genuinely shared.

## Feature apps

For cohesive features start with apps/{id}/manifest.json and App.ts. The root
service extends AppService; shared/ is optional. Read src/apps/README.md before
changing discovery, install/uninstall, owned migrations or npm extraction. Use
app().social for an optional generated service type. Do not add per-app host
registration or mix feature models into the host snapshot. Marked npm dependencies
are discovered using their exported package.json. Migrations and down functions
belong to the app; npm lifecycle hooks must never mutate SQL. Starter ships
administrator controls for single-process hosts; multi-process maintenance
requires stopping all consumers before CLI actions.

## Application source naming

Name each file for the main concept it owns. Follow these conventions for new
files and files moved as part of an implementation:

- A file whose primary export is a class uses PascalCase and matches the class name exactly, for example `QueueWorker.ts`, `SendInvoiceJob.ts`, or `User.ts`.
- Vue component files use PascalCase, for example `AccountSettings.vue`.
- A file whose primary purpose is one exported public contract, interface, or type uses PascalCase and matches that concept, for example `PaymentResult.ts`.
- Function modules use camelCase on both server and client. When a file owns one exported function, match its name exactly: `invoiceDeliver.ts` exports `invoiceDeliver`, and `useInvoice.ts` exports `useInvoice`.
- Cohesive helper/utility modules and stores use camelCase names describing their purpose. Composables start with `use`.
- Feature directories use kebab-case. Framework-owned route parameters, route method suffixes, migrations, generated files, and required `index.ts` entry points keep the naming required by their owning system.
- Test filenames mirror the source concept or route they verify and end in `.test.ts`.

Keep one main concept per file. Do not copy an inconsistent neighbouring name
as precedent. When a task already changes or moves an inconsistent file, rename
it and update imports, tests, documentation, package exports, and dynamic
registries. Do not turn a focused task into an unrelated repository-wide rename.

Prefer behaviour on the service, model, or other domain object that owns it,
especially when it uses state, dependencies, or side effects. Pure functions
may be grouped into cohesive, purpose-named helper modules within the owning
service. Keep helpers local when only one implementation needs them. Avoid
unrelated utility buckets and one-off service classes created only to wrap a
function. Required route and command adapters delegate to the owning behaviour.
When migrating flat server/service files, establish ownership before renaming.

## AI workflows

For AI work, read `src/ai/README.md` and its examples first. Use `app().ai` and
the exported `Agent` class for provider calls, tools, conversations, request
tracking and queued runs. Keep application prompts, authorization, storage
destinations and commercial policy in the app. Extend the shipped AI records
through `ai.models` and committed migrations. Do not copy the SDK runner or
tracking implementation into application helpers or assume fluent builders
that are absent from the installed declarations.

## Verification

- Type-check application code against the installed package exports.
- Add behavioural tests for application workflows using real framework services.
- Use disposable databases for database-backed tests.
- Mock external providers, not framework-owned behavior.
- Run the consuming application's focused tests and type check after changing
  framework usage.
