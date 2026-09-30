# db3.ai Framework

Typed TypeScript application framework packaged as `@db3.ai/app` and
`@db3.ai/pure`, with the `@db3.ai/create` application starter. This repository
contains their public source, the runnable starter, service documentation, examples and behaviour tests.

This is the development branch, not a stable npm release. Packages are not yet
published. Run [apps/starter](./apps/starter/README.md) directly from this checkout
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
The documentation website will join this repository after its build is portable.
It is not included in this initial source export.

[The framework release policy](./docs/framework-release.md) defines the reviewed,
non-publishing candidate gate. The checked-in workflow has read-only repository
permissions and creates inspected tarball evidence only; it cannot publish to npm.

Version: `0.1.0-beta.3`  
License: `MIT`  
Repository: <https://github.com/db3ai/framework>
