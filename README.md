# db3.ai Framework

Typed TypeScript application framework packaged as `@db3.ai/app` and
`@db3.ai/pure`, with the `@db3.ai/create` application starter. This repository
contains their public source, the runnable starter, service documentation, examples and behaviour tests.

This is the development branch, ahead of the published npm prerelease.
Run [apps/starter](./apps/starter/README.md) directly from this checkout
to develop and try framework features. Its local environment file is ignored by
Git. AI is optional. The [independent consumer checks](./packages/create/README.md#test-the-unpublished-preview)
verify the same app against packaged framework releases.

## Packages

- [`@db3.ai/app`](./packages/app/README.md) provides application lifecycle,
  database, queue, scheduler, auth, storage, media, mail, SSR, and related services.
- [`@db3.ai/pure`](./packages/pure/README.md) provides environment-independent
  utilities shared by framework packages and applications.
- [`@db3.ai/create`](./packages/create/README.md) generates a Vue/DOM Studio app
  with password login, private notes and optional server-side AI summaries.

Provider packages share this repository: `@db3.ai/notifications-intercom`
(Messenger in-app messages), `@db3.ai/mail-resend` and `@db3.ai/mail-mailgun`.
They own provider dependencies and consume public core contracts. Applications
explicitly register only the providers they need. The package staging command
builds their runtime and declaration exports alongside App and Pure; no separate
repository or npm publication is required for local development.

## Development

Requirements: Node.js 24 or newer, MariaDB for database integration suites, and
Redis for the complete release gate.

```sh
npm ci
cp apps/starter/.env.example apps/starter/.env
cp packages/app/.env.test.example packages/app/.env.test
npm run check
npm test
npm run test:release
```

Configure a dedicated application database and test account using the
[starter README](./apps/starter/README.md). Then run:

```sh
npm run db:migrate --workspace db3-starter
npm run dev:starter
```

The starter uses local framework workspace packages while you develop. Its source
is also bundled into Create; edit apps/starter rather than a second template.

The clean consumer gate compiles, packs, installs, imports, and type-checks both
packages without publishing them:

```sh
npm run framework:package:test
```

## Release candidates

`main` contains upcoming work. Maintained version branches and immutable release
tags will identify supported releases; there is no stable release tag yet.
The public documentation website lives at
[`apps/framework`](./apps/framework/README.md). It is a separate
deployment root with its own `index.ts`; the framework packages are build inputs.
It serves `https://db3.ai/framework`, with guides under `/framework/docs/...`.
Run `npm run docs:dev` or `npm run docs:build` from this repository root.

Packaging (`framework:package`), independent consumers (`framework:package:test`
and `framework:create:test`), and release/publishing commands (`framework:release:*`
and `framework:publish*`) run from this repository. The old Platform-only
`framework:export:public*` commands created this public checkout; they are not
part of its ongoing package release workflow.

## Working across applications

Keep this checkout alongside application repositories, rather than nesting it
inside a private product. npm workspaces connect the packages, starter and docs
inside this repository. Consumers use explicit package versions or reviewed
packed artifacts, never implicit imports from a sibling checkout.

In Codex, add this directory as its own project. For a cross-repository change,
implement and test the shared behavior here, verify packed imports and types,
then update and test each affected consumer. Record the framework revision and
consumer dependency change together in the handoff. Independent app changes
need only that app's project context.

[The framework release policy](./packages/app/RELEASING.md) defines the reviewed,
non-publishing candidate gate. The checked-in workflow has read-only repository
permissions and creates inspected tarball evidence only; it cannot publish to npm.

Version: `0.1.0`
License: `MIT`  
Repository: <https://github.com/db3ai/framework>
