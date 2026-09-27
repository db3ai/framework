# db3.ai Framework Agent Instructions

This repository contains public framework source, tests, examples, and package
release tooling, plus apps/starter as the runnable example and feature playground.

## Orientation

- Read `packages/app/package.json`, `packages/app/README.md`, and the relevant
  service README and public barrel before changing App.
- Read `packages/pure/README.md` and the focused utility module before changing Pure.
- Read `packages/create/README.md`, apps/starter and the creator safety tests before changing Create.
- Follow `docs/framework-conventions.md` for service ownership, contracts,
  examples, exports, and documentation.
- Keep service behaviour tests under `packages/app/src/{service}/tests`.
- Use `client/` for browser code and `server/` for backend code in new apps,
  following apps/starter, with migrations and schema snapshots in `server/database/`.
  Framework library source stays in package `src/` directories.

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
```
