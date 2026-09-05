# Framework Service Module Migration Plan

This record defines the package-shaped ownership convention established by the completed framework test migration. Queue was the pilot module; every current framework test now lives with the service whose public behaviour it verifies.

## Target Shape

Each service owns its complete development surface:

```text
packages/app/src/{service}/
	index.ts
	README.md
	contracts/
	drivers/
	examples/
	tests/
```

Not every service needs every directory. Add `contracts/`, `drivers/`, or test-support directories only when the service has those concepts.

The package root continues to own application composition and public subpath exports. Behaviour that spans several services still belongs to the service whose outcome it asserts; do not recreate a package-root test directory.

## Queue Pilot

Queue establishes the convention by:

1. Moving existing Queue tests from `packages/app/tests/queue` to `packages/app/src/queue/tests`.
2. Grouping driver tests beneath `queue/tests/drivers`.
3. Adding production-shaped examples beneath `queue/examples`.
4. Executing at least one example from a Queue-owned behaviour test.
5. Rendering the same example source in the documentation website.
6. Keeping production builds free of examples, tests, fixtures, and support files.
7. Recording Queue's database, logging, monitoring, scheduler, flow, and application-root relationships in its README.

Queue established this convention with focused tests, package checks, documentation checks, production-safe build exclusions, and no remaining package-root Queue tests.

## Migration Waves

### Wave 1: Small leaf services (complete)

Services with narrow dependencies and small test suites:

- `validation`
- `config`
- `events`
- `cache`
- `logging`
- `security`
- `storage`
- `mail`

Their existing tests now live beneath each service's `tests/` directory.

### Wave 2: Data-backed application services (complete)

Services that depend more heavily on database or application models:

- `auth`
- `media`
- `serialization`

Their database integration tests remain within the owning service. Shared disposable-database utilities live under the database service and are consumed through its explicit test-support boundary.

### Wave 3: Orchestration and development services (complete)

Services whose behaviour composes multiple framework capabilities:

- `scheduler`
- `flows`
- `devtools`

Assign each cross-service test to the service whose outcome it asserts. For example, a Scheduler test that dispatches Queue jobs belongs to Scheduler; a Queue lifecycle test observed by devtools belongs to Queue unless the assertion is specifically about devtools delivery.

### Wave 4: Foundation boundaries (complete)

Foundational modules migrated after the dependent service boundaries were proven:

- `db`
- `server`

These modules are likely future roots for standalone packages such as `@db3.ai/db` and `@db3.ai/core`. Moving them last avoids repeatedly changing every dependent service while the package-shaped convention is still being refined.

The unused `deploy` placeholder was removed instead of being presented as a supported service. A future deployment service should start from a real consumer workflow, typed public contract, and behavioural tests.

## Future Package Extraction

Co-located service modules prepare for, but do not require, standalone packages. A future package graph may look like:

```text
@db3.ai/core
@db3.ai/db
@db3.ai/queue
@db3.ai/storage
@db3.ai/ai
@db3.ai/framework
```

`@db3.ai/core` would own application context, configuration, lifecycle, and basic service registration. Individual packages would own their service contracts and implementation. `@db3.ai/framework` or a future application root package would provide the batteries-included composition and convenience exports.

Do not create standalone packages solely to satisfy this target diagram. Extract a service only when independent versioning, dependency weight, reuse, ownership, or release cadence makes the additional package worthwhile.

## Per-Service Checklist

1. Inventory source, tests, fixtures, examples, README content, and sibling imports.
2. Move tests and fixtures into the service without changing behaviour.
3. Make production build, test, coverage, and example include/exclude rules explicit.
4. Ensure supported imports pass through the service barrel.
5. Replace copied documentation snippets with service-owned example files.
6. Execute examples with deterministic tests and controlled external dependencies.
7. Record sibling dependencies and consumers in the service README.
8. Run focused tests, package checks, documentation checks, and `git diff --check`.
9. Remove the old package-root test directory when it is empty.
10. Migrate only one service at a time unless a shared test-support change requires a tightly related pair.
