# Server

`@db3.ai/app/server` provides the framework application service hub, the
active-application accessor used by framework code, and isolated request-scoped
state. Despite the module name, it does not create or own an HTTP server. A
Fastify, Express, CLI, worker, or test runtime creates an `App` and integrates
its own process boundary.

## Module Ownership

Server is the framework composition root inside `packages/app`:

```text
server/
	App.ts
	appContext.ts
	RequestContext.ts
	tests/
	index.ts
	README.md
```

`App` composes framework services but leaves their behavior in the owning
service modules. It currently discovers database, auth, request context, cache,
events, logging, URL, queue, scheduler, security, serialization, storage, and
media services. Application-specific capabilities belong on an application
subclass and can reuse `service(...)` for lazy singleton ownership.

## Public API

Import the application boundary from its supported subpath:

```ts
import { App, app, clearActiveApp, RequestContext, type AppOptions } from '@db3.ai/app/server';
```

The public surface includes:

- `App` and `AppOptions` for framework service composition and lifecycle.
- `app<TApp>()` for resolving the active application from models, jobs, and
  other code running inside a bootstrapped process.
- `setActiveApp(...)` and `clearActiveApp(...)` for explicit runtime and test
  ownership.
- `activeAppDatabase()` and `activeAppRequestContext()`, which expose optional
  low-level context to framework internals.
- `RequestContext` and `RequestContextValues` for request-isolated values.

Normal application code should use `app().db`, `app().queue`, and the other
service getters. `activeAppDatabase()` is a framework escape hatch, not a
second application data-access pattern.

## Application Setup

Create one application during process boot and close it during shutdown:

```ts
import { App } from '@db3.ai/app/server';

const application = new App({
	config: {
		cache: {
			default: 'memory',
		},
	},
	url: {
		baseUrl: 'https://example.com',
	},
});

process.once('SIGTERM', async () => {
	await application.close();
});
```

Constructing `App` registers it as the process's active application. Service
getters instantiate their service on first access and return the same instance
thereafter.

`AppOptions` accepts explicit database, database behavior, auth, config,
logging, URL, queue, serializer, and storage configuration. Cache, media, and
security read their named options from the application config repository. When
`config.security` exists, construction resolves the security service
immediately so invalid key configuration fails during boot rather than on the
first encrypted operation.

The default database connection is owned by the framework and is closed by
`App.close()`. An injected `db` connection remains owned by its caller and is
not destroyed during application shutdown.

## Extending The Service Hub

An application can expose domain services without adding them to the reusable
framework root:

```ts
import { App as FrameworkApp } from '@db3.ai/app/server';
import { createMailFromEnv, type Mail } from '@db3.ai/app/mail';

export class Application extends FrameworkApp {
	/**
	 * Returns the application-owned outbound mail service.
	 *
	 * @returns Shared mail service configured from the process environment.
	 */
	get mail(): Mail {
		return this.service('mail', () => createMailFromEnv());
	}
}
```

Use a stable, application-owned service name. `set(name, instance)` replaces or
registers a concrete service, which is useful for runtime adapters and tests.
`service(name, factory)` only invokes its factory when no truthy instance has
already been stored.

## Active Application Context

Framework models and queued jobs can resolve the current service hub without
threading an `App` argument through every API:

```ts
import { app } from '@db3.ai/app/server';

await app().queue.dispatch(new GenerateReportJob({ reportId }));
```

The active application is process-global. Constructing or explicitly setting a
second application replaces the prior active reference, so runtimes should not
interleave multiple application instances in one process. Tests must close or
clear applications they create to prevent state leaking into another test.

`clearActiveApp(application)` only clears the context when that application is
still active. Calling it without an argument unconditionally clears the active
reference.

## Request Context

`RequestContext` uses Node `AsyncLocalStorage` to isolate values across
concurrent asynchronous request chains. An HTTP adapter should wrap the complete
request lifecycle:

```ts
return application.requestContext.run(async () => {
	application.requestContext.set('requestId', request.id);

	return handleRequest(request);
});
```

Use `get`, `has`, `set`, and `delete` for explicit values. `remember(...)`
computes a value once per active request and shares an in-flight promise with
concurrent consumers in that request:

```ts
const user = application.requestContext.remember('auth.user', async () => {
	return authenticateRequest(request);
});
```

A rejected remembered promise removes itself from the request store, allowing a
later call to retry. Outside an active request, `remember(...)` invokes its
factory normally without caching, while `set(...)` throws because there is no
request-owned store.

## Shutdown And Failure Behaviour

`App.close()` clears the active reference when it owns it, detaches the Scheduler recorder,
clears Events listeners, awaits Cache and Log shutdown, closes the
framework-owned default database, and clears cached service instances.
Application subclasses remain responsible for closing any additional resources
they introduce.

It does not stop a `SchedulerWorker`, drain Queue workers, or close a Redis
queue driver. Stop accepting work, finish or deliberately terminate workers,
and close their owned transports before closing the App, while running jobs
can still resolve `app()`. An injected database remains caller-owned.

Calling `app()` before boot fails with `No active application has been
created.`. Invalid `DB_SYNC_COLUMNS` values also fail explicitly; accepted true
values are `1`, `true`, `yes`, and `on`, while false values are `0`, `false`,
`no`, and `off`. When unset, automatic safe column synchronization remains
enabled unless `dbOptions.syncColumns` overrides it.

The application hub is not an HTTP dependency container, request router, or
durable registry. Process startup remains responsible for constructing the app,
registering models, jobs and adapters, and attaching clean shutdown handlers.

## Testing And Verification

The shipped [application factory](./examples/createFirstServer.ts) and
[process entry point](./examples/startFirstServer.ts) form the independent
first-app walkthrough. After installing the package, Fastify, `tsx`, TypeScript
and Vitest, copy `src/server/examples` into an application's `examples`
directory and run `npx tsx examples/startFirstServer.ts`.
The website includes the exact consumer-copyable HTTP injection test.


The service-owned tests cover active-app lookup and request-context isolation,
memoization, promise sharing, rejection recovery, and behaviour outside a
request:

```sh
npm run test:service --workspace packages/app -- server
```

Run the complete framework suite and source checks before publishing a change:

```sh
npm test --workspace packages/app
npm run check --workspace packages/app
```

Tests that create an `App` must use a disposable test database or inject the
specific real framework component they need, then call `close()` or
`clearActiveApp()` during cleanup. Relevant implementation lives in
[`App.ts`](./App.ts), [`appContext.ts`](./appContext.ts),
and [`RequestContext.ts`](./RequestContext.ts). Behavioural tests live at
`packages/app/src/server/tests/` in the source repository and are not included
in the installed runtime package.
