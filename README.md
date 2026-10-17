# db3.ai Framework

Typed TypeScript application framework packaged as `@db3.ai/app` and
`@db3.ai/pure`, with the `@db3.ai/create` application starter. This repository
contains their public source, the runnable starter, service documentation, examples and behaviour tests.

[db3.ai website](https://db3.ai/) · [Framework documentation](https://db3.ai/framework) · [Getting started](https://db3.ai/framework/docs/welcome) · [Dock guide](https://db3.ai/framework/docs/dock)

The `main` branch contains ongoing development; `0.1.x` maintains the 0.1 release line.
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

The provider package `@db3.ai/notifications-intercom` lives here
(Messenger in-app messages). Provider packages own their dependencies and consume public core contracts. Applications
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

## Releases

Install the released framework with `npm install @db3.ai/app`, or create an app
with `npm create @db3.ai@latest my-app`. The non-beta release line starts at
`0.1.0`; prereleases remain available separately under `next`.

Maintained version branches and immutable annotated tags identify releases.
Publishing a GitHub release runs the full checks and publishes all three npm
packages through trusted publishing. Stable versions use `latest`.
The public documentation website lives at
[`apps/framework`](./apps/framework/README.md). It is a separate
deployment root with its own `index.ts`; the framework packages are build inputs.
Read the [framework documentation](https://db3.ai/framework), with guides under `/framework/docs/...`.
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
packed artifacts for deployment. Explicit consumer development links may select
this checkout locally; restore and verify the pinned dependency before deployment.
This repository is the editable master for framework packages, starter and docs.
Consumer source snapshots and package archives are generated deployment inputs,
not additional development sources.

In Codex, add this directory as its own project. For a cross-repository change,
implement and test the shared behavior here, verify packed imports and types,
then update and test each affected consumer. Record the framework revision and
consumer dependency change together in the handoff. Independent app changes
need only that app's project context.

[The framework release policy](./packages/app/RELEASING.md) documents automatic
publication, versioned tags, verification-only runs and manual recovery.

Version: `0.1.0`
License: `MIT`  
Repository: <https://github.com/db3ai/framework>

## Dock

[Dock](https://db3.ai/framework/docs/dock) runs your local projects and npm scripts
with live terminals, process controls and Git branch information. Connect Docker
hosts over SSH to inspect containers, logs and the routes serving your apps.

Run `npm run dev:dock` from this checkout. See the
[Dock README](./apps/dock/README.md) for setup and configuration, or follow the
[illustrated guides](https://db3.ai/framework/docs/dock) on db3.ai. Dock runs from
source; packaged desktop installers are not available yet.

## Flow editor and lab

`packages/flow-designer` owns the reusable Vue graph editor and run inspector.
`apps/flow-lab` retains standalone flow examples and their database tests.
Run `npm run dev:flow-lab` for the lab; the project-scoped Cloud product lives
in the separate db3.ai repository at `apps/flows`.
