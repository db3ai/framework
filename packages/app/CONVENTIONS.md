# Framework Conventions

This document defines repeatable conventions for framework code in `packages/*` and the applications that use it. The goal is to make framework APIs easy to find, easy to import, and easy to document without turning simple implementation details into architecture.

## Application Layout

New DB3 applications use sibling `client/` and `server/` directories:

```text
my-app/
	client/       Browser entry point, Vue components, styles and API calls
	server/       Backend configuration, routes, models, jobs and services
		cli.config.ts   App factory and framework service command registration
		database/   Model registry, migrations and schema snapshot
	tests/        Application behaviour tests
	index.html    Vite entry document loading /client/main.ts
```

`apps/starter` is the runnable reference for this layout and the source copied
by Create. Keep browser code under `client/` and backend code and configuration
under `server/`. Framework packages retain their own `src/`
directories; those contain library implementation rather than an application's
browser code. Existing apps can adopt this layout through focused migrations.

Database ownership stays with the server in both local development and
production. Browser code accesses it through the server API. Keep committed
migrations in `server/database/migrations/` and the schema snapshot beside them
at `server/database/schema.snapshot.json`; include both in server deployments.
These paths are fixed conventions for `app().db.migrations`. Register models
with `dbOptions: { migrations: { models } }`; do not create a separate
`migrations.ts` configuration file. `App.directory` defaults to the working
directory at construction. The starter sets `directory: new URL('../', import.meta.url)`
in `server/app.ts` so HTTP, commands and tests share the same app root regardless
of where they are launched.

The framework owns the `db3` executable and shared CLI runner. Services expose
commands through their public barrels and keep command adapters in their owning
modules. Apps register configured commands in `server/cli.config.ts`; keep help,
argument parsing, exit statuses and app lifecycle out of app-owned scripts.
Commands call the service's existing programmatic operations.

`npx db3 repl` opens a terminal REPL inside the same app lifecycle. It exposes
`app()` and named models from the `models` array in `server/database/models.ts`.
The starter includes `npm run repl` and `npm run db3 -- <command>` shortcuts.
The CLI closes the app when the REPL exits; no HTTP listener is started.

Use `service:action` names and one action function per file under the service's
`commands/` directory. A small `commands/index.ts` imports and registers public
actions with `defineCommand()`, mapping named parameters and terminal results.
Actions execute in the active app context, use `app()` and return normal values
so application and UI server handlers can call them directly.

## Frontend Development

Follow the [frontend development rules](agent-instructions.md#frontend-development)
before creating or changing frontend behaviour. They define component,
composable, store and plain-function ownership, lifecycle cleanup and direct
behavioural verification. Existing examples do not override those rules.

## File Naming

Platform enforces the mechanically checkable naming rules with
`npm run conventions:check`, also included in its root check and application CI.
See `../../tools/code-quality/NAMING.md` for exact coverage, exclusions and debt
handling. This repository gate is not yet shipped to generated applications.

Name each file for the main concept it owns. These conventions apply to
framework source, starter code, generated applications, and examples:

- Files whose primary export is a class use PascalCase and match the class name exactly, for example `QueueWorker.ts`, `SendInvoiceJob.ts`, or `User.ts`.
- Vue component files use PascalCase, for example `AccountSettings.vue`.
- Files whose primary purpose is one exported public contract, interface, or type use PascalCase and match that concept, for example `QueuePayload.ts` or `PaymentResult.ts`.
- Function modules use camelCase on both server and client. When a file owns one exported function, match its name exactly: `invoiceDeliver.ts` exports `invoiceDeliver`, and `useInvoice.ts` exports `useInvoice`.
- Cohesive helper/utility modules and stores use camelCase names describing their purpose. Composables start with `use`.
- Feature directories use kebab-case. Framework-owned route parameters, route method suffixes, migrations, generated files, and required `index.ts` entry points keep the naming required by their owning system.
- Test filenames mirror the source concept or route they verify and end in `.test.ts`.

Keep one main concept per file. Existing inconsistent names are migration debt,
not precedent. Rename one when its owning module is already being changed or
moved, and update imports, tests, documentation, package exports, dynamic
registries, and generated sources. Do not widen an otherwise focused change
into an unrelated repository-wide rename.

Generated applications include a root `AGENTS.md` with the concise naming rules
and a pointer to the installed `@db3.ai/app/agent-instructions` export. Existing
applications can add or refresh that marked framework block with `db3-agents`.

## Service-Owned Modules

Each reusable framework service should be a self-contained, package-shaped module inside its current package. Source, public contracts, drivers, documentation, examples, tests, fixtures, and test support belong to the service that owns the behaviour.

Prefer behaviour on the service, model, or other domain object that owns it,
especially when it uses state, dependencies, or side effects. For example,
invoice delivery can belong to `InvoiceService.deliver()` in `InvoiceService.ts`.
Pure functions may be grouped into cohesive, purpose-named helper modules within
the owning service, such as `invoiceTotals.ts`. Keep helpers local when only one
implementation needs them. Avoid unrelated utility buckets and one-off service
classes created only to wrap a function. Required route and command adapters
delegate to the owning behaviour.

When migrating flat server/service files, establish ownership first, then choose
the matching filename. A kebab-case filename alone does not prove that its code
needs a new class or should be merged with another service.

Queue is the reference layout:

```text
packages/app/src/queue/
	index.ts
	README.md
	Queue.ts
	QueueableJob.ts
	contracts/
	drivers/
	examples/
	tests/
		drivers/
		examples/
		support/
```

This keeps `packages/app` simple to install today while making each service boundary visible enough to extract into a standalone package later. A future extraction should primarily move one service directory, declare its existing dependencies, and update the root application package to compose or re-export it.

Follow these ownership rules:

- Keep service documentation in the service `README.md`.
- Keep production-shaped, copyable examples in `examples/`.
- Keep behaviour, integration, fixtures, and support code in `tests/`.
- Import a sibling service through its public barrel instead of reaching into private implementation files.
- Export every supported application API through the owning service `index.ts`.
- Keep app-specific models, jobs, prompts, routes, and orchestration in the consuming app.
- Assign cross-service integration tests to the service whose public outcome they assert; do not create a package-root `tests/` directory.

Examples and tests have different consumers. Examples should contain complete application-shaped usage without assertions or test-runner APIs. Tests should import and execute those examples with deterministic framework components and controlled external providers. Documentation should render the example source instead of maintaining a copied code string.

Production builds must exclude colocated `tests/` and `examples/` directories. Dedicated test and example checks should still type-check them, and documentation verification should fail when a rendered example no longer matches its service-owned source. Run the complete package suite with `npm test --workspace packages/app` or one owning service with `npm run test:service --workspace packages/app -- {service}`.

Co-location does not mean a service is already independent. Record current sibling dependencies in its README and preserve them as explicit boundaries. Queue currently depends on database and logging services and is composed by the application root; those dependencies can become package dependencies if Queue is extracted later.

## Contract Files

Use a `contracts/` directory inside a framework module when a type or interface represents a public service boundary, driver boundary, lifecycle API, payload envelope, options object, or result shape.

Good examples:

```text
packages/app/src/queue/
	contracts/
		QueueDriver.ts
		QueuePayload.ts
		QueueService.ts
		QueueWorkerLifecycle.ts
		QueueableJob.ts
		index.ts
	Queue.ts
	QueueWorker.ts
	QueueableJob.ts
```

Prefer `contracts/` over `interfaces/`. Contracts are not only TypeScript `interface` declarations; they can include public type aliases, payload envelopes, options, and result shapes that form the API.

Name contracts by purpose, not by implementation syntax. Use `QueueService`, `QueueDriver`, and `QueueWorkerLifecycle`, not `IQueueService` or `IQueueWorker`.

Keep one main concept per file. Related payload fields can live together when splitting them would make the API harder to understand, for example `QueuePayload.ts` can own `JobEnvelope`, `QueueJob`, `DispatchOptions`, and `QueueProcessResult`.

## Imports

Use the public `@db3.ai/*` package names in workspace dependencies, application
imports, examples, tests, and documentation. `packages/app` is `@db3.ai/app`,
`packages/pure` is `@db3.ai/pure`, and `packages/create` is `@db3.ai/create`.

Local workspaces resolve these names to TypeScript source. Staged packages
resolve the same names to compiled JavaScript and declarations. Packaging and
documentation generation must preserve package names instead of translating
between private and public scopes.

Implementation files should usually import contracts as a namespace:

```ts
import type * as queue from './contracts';
```

Then refer to contract types through that namespace:

```ts
export class Queue implements queue.QueueService {
	#driver: queue.QueueDriver;

	async dispatch(
		job: string,
		data: Record<string, unknown>,
		options: queue.DispatchOptions = {},
	): Promise<queue.QueueJobId> {
		// ...
	}
}
```

Keep runtime imports separate from contract imports:

```ts
import { QueueWorker } from './QueueWorker';
import type * as queue from './contracts';
```

Avoid long named type import lists from shared type buckets. If a file needs many public queue contracts, that is a signal to use the module namespace.

## Exports

The module barrel should export the public contracts:

```ts
export * from './contracts';
```

Concrete implementation files may re-export their closely related contracts when that keeps existing import paths intuitive:

```ts
export type { QueueService, QueueOptions } from './contracts';
```

Do not keep duplicate public type buckets such as `types.ts` beside a formal `contracts/` directory. One public source of truth is easier to maintain and document.

## Local Types

Keep private helper shapes near the implementation when they are not part of the framework API:

```ts
interface ParsedInternalRow {
	id: number;
	payload: unknown;
}
```

Promote a local type into `contracts/` when app code, another framework module, a driver, a worker, a public method, or documentation needs to rely on it.

## Comments

Public framework APIs need production-standard JSDoc block comments. This includes exported classes, functions, type aliases, interfaces, options objects, result objects, and non-obvious fields.

Use comments to explain ownership and boundaries, not just repeat names. A useful contract comment says who creates the shape, who consumes it, and what a caller can rely on.

Good field comments:

```ts
/**
 * Per-dispatch overrides for queueing one job.
 */
export interface DispatchOptions {
	/**
	 * Named queue/channel the job should be pushed onto.
	 *
	 * Workers process one named queue at a time, so this lets callers route
	 * different classes of work to different worker pools. When omitted, the
	 * queue service uses its configured default queue name.
	 */
	queue?: string;
}
```

Add `@param` and `@returns` for functions and methods that form part of an API. Add `@example` when a caller would otherwise need to inspect tests or implementation to understand intended usage.

Private functions should also have docblocks when their purpose, boundary, or failure behavior is not obvious. Do not add empty narration to trivial code.

## Review Checklist

Feature and service tests should import the smallest owning module and use only
the models required by their behaviour. Boot the complete host and install its
whole schema when the asserted contract requires that composition. Keep a small
set of host integration tests alongside independently runnable feature tests;
adding one app should not make unrelated tests load its code or create its tables.

Before finishing a framework contract change:

1. Check whether the public shape belongs in `contracts/` or should stay local.
2. Use namespace imports for contract-heavy implementation files.
3. Keep runtime imports and type contracts visually separate.
4. Remove duplicate type buckets after moving the contract.
5. Add JSDoc to exported contracts and non-obvious fields.
6. Run focused tests and type checks for both the framework package and any app that consumes it.
7. Update README or architecture docs when the public API, convention, or usage changed.
8. Add or update a service-owned example when a common application workflow changed.
9. Keep service tests, fixtures, and example verification inside the owning service directory.

## Feature apps within a host

Prefer `apps/{id}/` with root `manifest.json` and `App.ts`. The class default
extends `AppService`; server/, client/, database/ and optional shared/ belong
inside that folder. Discovery replaces per-app host registration. Marked direct
npm dependencies use the same structure, with compiled entry paths in package
metadata. Keep general libraries in packages/ and framework implementation in
packages/app/src.

The root manifest is browser-safe metadata for visual exploration and default navigation.
An app's `navigation(context)` can return current links, plain-text information and
badges for a host-verified viewer. `apps.navigation(context)` collects enabled-app
contributions; keep viewer state off shared service instances and out of `describe()`.
`app().social` resolves an optional service; generated declarations supply its
type. Framework service and registry names are reserved. Apps own prefixed models,
snapshots, immutable migrations and their down functions; host models stay separate.
Uninstall retains data; rollback is explicit. Npm lifecycle hooks never migrate SQL.

Starter ships discovery, generated browser loaders and an administrator Apps UI.
Online lifecycle management requires a single-process host; stop all consumers
for multi-process CLI maintenance. See [Apps](src/apps/README.md)
for both local and npm workflows and the one-time custom-host integration.

## Human and agent application workspace

Each application owns a concise `AGENTS.md`, a current setup/usage `README.md`
and a disposable `plans/` directory. Agent guidance names entry points, ownership
boundaries and verification commands; link shared conventions rather than copy
them. In Platform, link this file. Independent installed apps resolve
`@db3.ai/app/agent-instructions` for their framework version. The creator ships
the portable agent scaffold and planning policy, excluding existing drafts.

Plans hold proposed direction, never current APIs or reliability guarantees.
Do not read them as routine implementation context or make builds/tests depend
on them. Keep verified behavior beside the owning code; remove completed plans.
