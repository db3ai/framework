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

- Keep product models, routes, jobs and policy in the consuming application.
- Use ActiveRecord logical field names and let fields own database mapping,
  conversion, validation and JSON values.
- Resolve normal application services through the active `App` rather than
  threading optional Knex connections through app code.
- Put reusable mechanics in the framework only when they are genuinely shared.

## Verification

- Type-check application code against the installed package exports.
- Add behavioural tests for application workflows using real framework services.
- Use disposable databases for database-backed tests.
- Mock external providers, not framework-owned behavior.
- Run the consuming application's focused tests and type check after changing
  framework usage.
