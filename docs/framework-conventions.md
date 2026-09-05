# Framework Conventions

This document defines repeatable conventions for framework code in `packages/*`. The goal is to make framework APIs easy to find, easy to import, and easy to document without turning simple implementation details into architecture.

## Service-Owned Modules

Each reusable framework service should be a self-contained, package-shaped module inside its current package. Source, public contracts, drivers, documentation, examples, tests, fixtures, and test support belong to the service that owns the behaviour.

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

Implementation files should usually import contracts as a namespace:

```ts
import type * as queue from './contracts';
```

Then refer to contract types through that namespace:

```ts
export class Queue implements queue.QueueService {
	private readonly driver: queue.QueueDriver;

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
