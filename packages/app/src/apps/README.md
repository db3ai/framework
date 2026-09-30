# Apps: add a folder, then install

Put a cohesive feature in `apps/{id}/` inside the host application. DB3 discovers
its root `manifest.json` without importing its code. Install it from the Starter's
Apps screen or the CLI. There are no per-app host imports, model lists, navigation
registrations or CSS source directives to edit.

Start locally and extract the folder into an independent npm package when it
needs reuse or independent releases. General-purpose libraries still belong in
`packages/`. A feature app shares the host's runtime, database and authentication.

The documentation generator and packed Create test share the Hello fragments in
`examples/helloGuideSamples.ts`, allowing an independent public checkout to verify
the exact copyable tutorial code.

## Local structure

The runnable Social example is `apps/starter/apps/social` in this repository:

```text
apps/social/
	manifest.json
	App.ts
	database/
		migrations/20260926000100_social_opportunities.mjs
		schema.snapshot.json
	server/
		models/SocialOpportunity.ts
		routes.ts
	client/
		index.ts
		SocialApp.vue
	shared/                         # optional browser-safe contracts
	package.json                    # optional until packaging
```

The folder name is the official identifier: `social`. The root manifest describes
public metadata, icon, default navigation and dependencies. It need not repeat the id;
if present, `id` must agree with the folder name.

```json
{
	"name": "Social",
	"version": "0.1.0",
	"icon": "◎",
	"description": "Study discussions and save opportunities to contribute.",
	"apiVersion": 1,
	"navigation": [
		{ "id": "opportunities", "label": "Opportunities", "path": "" },
		{ "id": "about", "label": "About", "path": "about" }
	]
}
```

`App.ts` default-exports the public service. It can expose subservices as the app
grows. Extend `AppService`, not the host's framework `App`:

```ts
import { AppService } from '@db3.ai/app/apps';
import { SocialOpportunity } from './server/models/SocialOpportunity.js';
import { socialRoutes } from './server/routes.js';

/** Public Social service; the framework supplies the existing host. */
export default class App extends AppService {
	static override models = [SocialOpportunity];
	static override routes = socialRoutes;

	/** Returns discussions owned by an already authenticated caller. */
	async list(ownerId: string) {
		return (await SocialOpportunity.where('owner', ownerId).all()).map(record => record.toJSON());
	}
}
```

Static navigation can stay in JSON so a visual tool can inspect an uninstalled app
without executing its server code. Apps that need live counts, permission-aware
links or status information provide `navigation(context)` on their root service.
`client/index.ts` default-exports its browser component.
Its host supplies an app-relative `path` prop; Social handles its own About view.
Backend-only apps may omit `client/`. Do not put secrets in the manifest.

## Contributions from enabled apps

The registry owns the loop; each app owns the data it contributes. Navigation is
the first typed contribution. The manifest remains public, inspectable metadata;
`apps.describe()` never invokes viewer-specific providers.

```ts
import type { AppNavigation, AppNavigationContext } from '@db3.ai/app/apps';

// Inside the root App class:
/** Returns links and counts scoped to the already authenticated viewer. */
override async navigation(context: AppNavigationContext): Promise<AppNavigation> {
	const count = await SocialOpportunity.where({ owner: context.actor.id, status: 'saved' }).count();
	const badge = { count, label: `${count} saved opportunities` };
	return {
		badge,
		description: count ? 'Ready to review' : 'All caught up',
		items: [
			{ id: 'opportunities', label: 'Opportunities', path: '', badge },
			{ id: 'about', label: 'About Social', path: 'about' },
		],
	};
}
```

The host authenticates the request, then calls:

```ts
const navigation = await host.apps.navigation({ actor: { id: verifiedUser.id } });
// { apps: [{ appId, name, icon, items, badge?, description? }], unavailable: [] }
```

Only booted, enabled apps participate. Providers receive a frozen request context
and the host database scope. An optional `organisationId` must already be authorized
by the host; apps still enforce their own permissions. Never accept the actor from
query parameters or cache a viewer's data on the shared service instance.

- No override, or `undefined`: use manifest navigation, defaulting to no sublinks.
- An object: replace the manifest links with the current contribution.
- `null`: hide this app's navigation for this viewer.
- A failure or invalid result: omit only that app, include its id in `unavailable`,
  and log the server error. Do not fall back to links that a permission-aware
  provider may have intended to hide. No error details enter the browser payload.

Items have a stable `id`, text `label`, and safe app-relative `path`. Optional
`description` text and `{ count, label }` badges work on both apps and sublinks.
Counts are non-negative integers and badge labels provide accessible context.
The framework copies only declared display fields. App identity, name and icon
come from the registry. Navigation visibility does not authorize API access.

Starter exposes this through authenticated `GET /api/app-navigation` with
`Cache-Control: no-store`. Its generic menu renders the response, refreshes after
installation actions, when the window regains focus, and when an app component
emits `navigation-changed`. It also offers manual refresh. Social emits that event
after saves and status changes, so the badge updates without remounting the app.
There is no background polling or push transport in this initial contract.

Navigation requests participate in lifecycle draining automatically. Providers run
concurrently and the registry waits for them all; providers should use bounded
database/network operations. Programmatic `defineApp` compositions can supply
`navigation(context, service)` with the same return contract. Further contribution
types can follow this pattern when there is a concrete consumer.

## Use the Starter

Use Node 24 and MariaDB. Configure its `.env` using the Starter guide. Set
`APP_ADMIN_EMAIL` to the account allowed to manage apps, then:

```sh
npm run db:migrate
npm run dev
```

Sign in with that account, open **Apps**, and click **Install** on Social. Its
migrations run, the service starts, and its navigation becomes available. Save a
discussion, mark it answered and reload. Social is a private bookmark/review
example; it does not search social platforms or post replies.

Alternatively, with runtimes stopped:

```sh
npm run db3 -- apps:list
npm run db3 -- apps:install social
```

Adding another folder makes it discoverable on the next catalog read. Vite's
development plugin refreshes browser entries when manifests are added or removed.
Production browser bundles still need rebuilding when code is added or removed.
Changing an existing app's code/version requires restarting its server processes;
this implementation does not replace loaded JavaScript modules in place.

## One-time host integration

Starter already includes this wiring. A custom host sets its root directory,
boots apps before serving requests, mounts the authenticated adapter and exposes
the catalog. Omitting `apps` enables discovery; `apps: {}` opts out. An explicit
`defineApp` map remains available for tests and unusual compositions.

```ts
const host = new App({ directory: new URL('../', import.meta.url) });
await host.apps.boot();
```

For Vite frontends, add `appsPlugin()` from `@db3.ai/app/apps/vite` once. Import
client entries from `virtual:db3/apps`. The plugin generates lazy imports and
Tailwind sources for local and npm apps; server entries never enter that graph.
The Starter ships the virtual-module declaration and `AppWorkspace.vue`, which
renders the catalog, icons, sublinks and administrator actions. Other frontends
can render the same contracts using their own router.

`writeAppTypes(hostDirectory)` generates `.db3/apps.d.ts` without executing app
code. Include it in the host TypeScript configuration. Starter runs it before
type checking; Vite also runs it during development/build. Generated declarations
make direct access optional and typed:

```ts
import { app } from '@db3.ai/app/server';

const social = app().social;
if (social) await social.list(verifiedUserId);
```

`host.apps.get('social')` also supports runtime discovery. Framework service names,
registry names, prototype names and `db3`/`db3_` are reserved. Collisions fail before
app code loads. Identifiers start with a lowercase letter and contain at most 40
lowercase letters, digits or underscores.

A manifest can declare `requires: { crm: 1 }` and `optional: { social: 1 }`. Values
are exact public API generations, matching `apiVersion` (default 1). Required apps
must be enabled first. Missing optional apps are allowed; installed incompatible
contracts and cycles are rejected. Consume another app's public service, not its
internal models. Startup runs in dependency order.

## Lifecycle and administration

The base service provides these overridable asynchronous hooks:

- `install()` runs after migrations on install/upgrade. Make it retry-safe.
- `start(context)` starts resources. Use `context.defer(cleanup)` immediately
  after acquiring each resource. Cleanup runs in reverse order, including when
  startup fails. Constructors and module imports should not start resources.
- `uninstall()` handles durable deregistration and preflight checks. Throw if
  outstanding jobs or schedules would be stranded. The framework does not infer
  job cancellation from a deleted directory.

`host.apps.manage(action, id)` supports install, enable, disable and uninstall
inside an explicitly authorized **single-process** host. It rejects new app HTTP
requests while waiting for existing app requests, closes owned resources, applies
the action and boots the remaining apps. The Starter exposes it only to the
configured administrator, with session authentication and Origin protection.
Development enables the single-process policy; production additionally requires
`APPS_MANAGE_ONLINE=true`. Do not enable it when separate workers or replicas use
these app services. Calls outside the route adapter must use `apps.run()` to
participate in draining, and background resources must register cleanup.

For multiple processes, stop all affected web/worker runtimes and use the CLI.
The database advisory lock serializes installers; it cannot stop other processes.
Boot never applies migrations. `App.close()` releases app resources before shared
framework services. Installation is host-wide, not per tenant.

## App-owned migrations and down migrations

Feature models stay out of the host's model list and schema snapshot. Tables must
start with `{id}_`, such as `social_opportunities`. Each app owns `database/`, its
snapshot and immutable `.mjs` migrations beside `App.ts` (beside `dist/App.js` when
packaged). The framework keeps installation metadata in `db3_apps` and a separate
ledger such as `db3_app_social_migrations`. MariaDB is currently supported.

Generate changes locally, before publishing:

```sh
npm run db3 -- apps:make-migration social add_topic
```

Review and commit the migration and snapshot. The app author owns both `up()` and
`down()`. Generated `down()` defaults to an explicit refusal because an automatic
reverse can destroy data. Author and test a reversal **before first installing**
that migration if rollback is supported. The Social initial migration retains
that deliberate refusal. Do not rewrite an already applied migration to add one.

For a migration with an authored reversal, stop consumers and run:

```sh
npm run db3 -- apps:disable social
npm run db3 -- apps:rollback social
```

Rollback runs the latest migration's `down()` once, not every historical migration.
It can delete data and is deliberately absent from the web controls. The app is
left unavailable until `apps:install` reapplies its current migrations. Uninstall
never calls `down()` automatically and retains tables, records and history.

Increase the stable `x.y.z` manifest/package version for releases and use install
for upgrades. Installation fingerprints migration bytes and refuses changed or
missing history and version downgrades. A failed migration, install hook or schema
check leaves a failed installation; repair and retry. MariaDB DDL is not atomic.
Use `await host.apps.load(id)` before `host.apps.migrations(id)` for inspection or
source tooling outside the supplied commands. Never generate inside node_modules.

## Extract the same app to npm

Social includes an independent build and private package named `@db3.ai/social`.
The name is an example, not a claim of publication. From the host root:

```sh
npm pack ./apps/social --pack-destination /tmp
mv apps/social /tmp/social-source
npm install /tmp/db3.ai-social-0.1.0.tgz
```

Choose an unused extraction destination. Stop running consumers before switching
sources; restart/rebuild afterward. Do not keep both copies in discovery. No host
source edits are needed. Install from the Apps screen or `apps:install social`.
An identical local/package version reuses the existing migration history.

The npm package exports `package.json`, ships a root `manifest.json`, uses a
framework peer dependency and declares:

```json
{
	"name": "@your-scope/social",
	"db3": {
		"app": true,
		"entry": "./dist/App.js",
		"client": "./dist/client/index.js"
	},
	"exports": {
		".": { "types": "./dist/App.d.ts", "import": "./dist/App.js" },
		"./package.json": "./package.json"
	},
	"files": ["manifest.json", "dist"]
}
```

The final npm name segment (`social`) is its identifier. Discovery reads only
marked **direct** dependencies/optionalDependencies; it does not execute or scan
all transitive packages. Export the root service for generated types. Include
compiled browser code and copy migrations unchanged into `dist/database/`.
Social's build shows this complete pattern. Outside the monorepo, install its
declared development dependencies before building. `shared/` stays optional.

To remove an app, click **Uninstall · keep data**, then delete its local folder
or run `npm uninstall @db3.ai/social`. In multi-process hosts use
`apps:uninstall social` while all consumers are stopped and code is still present.
Rebuild the browser and restart servers after code removal. There are no host
imports to clean up. Required dependants must be removed first. If enabled code
was deleted prematurely, restore it to run its uninstall hook. Reinstalling a
compatible copy recovers retained data. Npm lifecycle scripts never migrate SQL.

## Verification and boundaries

`npm run framework:apps:test` builds actual tarballs, installs them into a clean
temporary consumer, generates service types, compiles TypeScript, builds discovered
browser entries, migrates a disposable database, runs real npm uninstall and
reinstall, and checks that records survived. Starter tests cover authenticated
routes and administrator actions; framework tests cover discovery, dependencies,
cleanup, in-flight draining, schema failures, history integrity and authored down
migrations.

Apps are trusted code in the host process, not a security sandbox. The manifest
supports visual exploration; visual definition editing, automatic social-platform
discovery, tenant installations and live replacement of existing code are future
work. Host authentication and authorization remain mandatory regardless of menu
visibility.
