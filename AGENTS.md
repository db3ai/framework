# db3.ai Framework Agent Instructions

This repository contains public framework source, tests, examples, and package
release tooling, plus apps/starter as the runnable example and feature playground.
The public documentation deploys from `apps/framework/index.ts`; read its
README before changing documentation or the site's deployment boundary.

This checkout is the editable master for public packages, the starter and docs.
Private consumers may link this source for development; their deployment snapshots
and packed artifacts must be refreshed explicitly and verified in each consumer.
Do not develop framework changes in a consumer snapshot.

## Orientation

- Read `packages/app/package.json`, `packages/app/README.md`, and the relevant
  service README and public barrel before changing App.
- Read `packages/pure/README.md` and the focused utility module before changing Pure.
- Read `packages/create/README.md`, apps/starter and the creator safety tests before changing Create.
- Follow `packages/app/CONVENTIONS.md` for service ownership, contracts,
  examples, exports, and documentation.
- Keep service behaviour tests under `packages/app/src/{service}/tests`.
- Use `client/` for browser code and `server/` for backend code in new apps,
  following apps/starter, with migrations and schema snapshots in `server/database/`.
  Framework library source stays in package `src/` directories.

## Frontend work

Before creating or changing frontend behaviour, read the
[frontend development rules](packages/app/agent-instructions.md#frontend-development).
Keep components focused on UI; put substantial behaviour in feature-owned
composables, stores or plain TypeScript functions as appropriate.

## Standards

- Use tabs for indentation and one main concept per file.
- Add production-standard JSDoc to public APIs and non-obvious functions, classes,
  contracts, and fields.
- Test observable behaviour with real framework components where practical.
- Use disposable test databases and mock only external provider boundaries.
- Verify consumer-facing changes through the packed-package runtime and TypeScript gate.

## Verification

```sh
npm run check
npm test
npm run test:release
npm run framework:package:test
npm run docs:build
```
