# Social app

Start with this folder inside a DB3 host's `apps/` directory. The framework
reads root `manifest.json` and discovers root `App.ts`; there is no host
registration code. Install from the Starter Apps screen or `db3 apps:install social`.

`App.ts` extends `AppService` and is the optional `app().social` public service.
It owns `server/models`, `server/routes.ts`, `database/` and `client/`. `shared/`
contains browser-safe data contracts and is optional. The manifest owns the icon;
`App.navigation(context)` provides links, status text and a saved-opportunity badge
scoped to the verified viewer. The client emits `navigation-changed` after writes
and handles its own sublinks. Models use social-prefixed
tables and the authenticated routes scope every record to its owner.

This is a runnable private-discussion bookmark workflow. It does not discover
social posts automatically, call platform APIs or publish replies.

For reuse, `npm pack` builds an independent, unpublished `@db3.ai/social` package.
It exports its root service and package.json, ships the root manifest and marks
itself with `db3.app: true`. The compiled browser entry and unchanged database
assets are included under `dist`. The framework is a peer dependency.

Move the local folder out of the host's `apps/` directory before installing the
tarball; duplicate ids are rejected. No host source or CSS changes are required.
Outside this monorepo install this package's development dependencies before
building. Rebuild browser bundles and restart servers after changing app code.

Uninstall through DB3 before deleting the folder or running npm uninstall. Tables,
records and migration history are retained. The initial migration's down function
intentionally refuses destructive rollback. App authors may provide tested down
functions in new migrations before those files are installed. Never rewrite the
existing migration to change that policy.

See the host Starter README and `@db3.ai/app` Apps service guide for full local,
package, administration and migration workflows.
