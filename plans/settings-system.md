# Settings system: proposed design

**Draft — proposed design, not implemented.** Written 10 November 2026 and
updated with Steve's review the same day. Discussion material, not part of the
published framework docs. Code using the APIs below cannot run against the
current package. Living copy with comments:
https://claude.ai/artifact/Wk7QkJH6XMJtXdCPENLzMW

## Summary

The framework provides a settings API and a Settings app. Any app declares its
settings in a `settings.ts` file using the same `field.*` builders models
already use, so validation and form rendering come for free. Values resolve
like iOS: the code holds the default, and a stored value at a narrower scope
(install, then organization, then user) overrides it.

Agreed so far:

- `get()` takes an optional default and never throws for an unset value.
- Integration keys are settings, stored encrypted.
- The settings API is part of the framework. The Settings app comes with every
  new project and can be ejected into the project to customize.

Still open: the scope chain (decision 2) and the cache plan (decision 3).

## What neon did, and what to keep

In neon (`neon/settings`), each app returned a `getSettings()` array of form
field configs (class, label, hint, items, `showIf`). The settings app looped
over active apps, built one sub-form per app, and saved each value through
`SettingsManager::set(app, key, value)` into a `settings` table of
`app, key, value(json)`. Reads went through `get(app, key, default)` from one
cached array, cleared on every write.

| Neon idea | Keep? | Why |
| --- | --- | --- |
| App describes its settings as fields | Keep | This is the core idea; the framework's `field.*` builders already carry label, default, validation and a form component. |
| One table keyed by app and key, JSON value | Keep, add scope | Small and generic; needs `scope_type` and `scope_id` for organizations and users. |
| Default passed at each `get()` call | Keep as a fallback | The declared default comes first, so every reader and the UI agree; the call-site default covers keys nobody declared. |
| Whole settings table cached as one blob | Change | Fine for one site; per tenant it must cache per scope, not every organization's values. |
| Field value seeded from live config (`neon()->formatter`) | Keep, narrowly | A default may read checked-in config, so env and config stay the boot layer and settings override at runtime. |
| Settings screen visible to administrators only | Change | Each scope gets its own editor: the super user for install, org admins for the organization, each person for themselves. |

## Declaring settings in an app

An app adds `apps/{id}/settings.ts` beside `manifest.json`. It default-exports
`defineSettings()`: groups for the screen, and one entry per setting made from
an existing `field.*` builder plus the scopes allowed to change it. The file
imports no server code, so the Settings app and the browser can both read it.

```ts
import { defineSettings, field } from '@db3.ai/app/settings';

export default defineSettings({
	groups: [
		{ id: 'publishing', label: 'Publishing' },
		{ id: 'email', label: 'Email', hint: 'Used for reports and alerts.' },
	],
	settings: {
		autoPublish: { group: 'publishing', scopes: ['organization'],
			field: field.boolean({ label: 'Publish articles automatically', default: false }) },
		reportDay: { group: 'email', scopes: ['organization', 'user'],
			field: field.choice({ label: 'Weekly report day', choices: ['monday', 'friday'], default: 'monday' }) },
		mailFromName: { group: 'email', scopes: ['install', 'organization'],
			field: field.string({ label: 'From name', default: 'GrowthScout', length: 80 }) },
		mailFromAddress: { group: 'email', scopes: ['install'],
			field: field.email({ label: 'From address' }), showIf: ['mailFromName', '!=', ''] },
	},
});
```

- **Default** lives in the field's `default`. Changing it in code changes it
  for everyone who has not overridden it.
- **Validation** reuses the field's rules (`required`, `choices`, `length`,
  email, URL), the same code path as `ActiveRecord.save()`.
- **Rendering** reuses `getFormComponent()`, which already returns a DomStudio
  component spec per field.
- **Integration keys** are settings too: `field.secret({ label: 'DataForSEO key' })`
  stores the value encrypted with the framework's existing `APP_KEY`
  encryption, never sends it back to the browser, and shows "Set, ends in 4f2a"
  with Replace and Remove. Env keeps only the boot secrets: the database
  connection and `APP_KEY` itself.
- **Types**: `writeAppTypes` already generates app types, so
  `settings.get('scout', 'reportDay')` can be typed as `'monday' | 'friday'`.

## Scopes

A value resolves from the narrowest scope that has one, then falls back to the
code default. Each setting lists the scopes allowed to override it, so
`mailFromAddress` can only ever be set by the super user, while `reportDay` can
be set by an organization and then changed by each person.

| Scope | Who edits it | Example |
| --- | --- | --- |
| Code default | Developer, in git | `reportDay = 'monday'` |
| `install` | Super user, in the app's own settings screen | GrowthScout-wide mail from address |
| `organization` | Organization owners and admins | Acme publishes articles automatically |
| `user` | Each signed-in person, for themselves | Steve wants his report on Friday |

```text
Code default  <--  Install  <--  Organization  <--  User
                                                    (a read starts here and moves left)
```

Only scopes a setting lists are consulted, so a user value is ignored for an
install-only setting.

The framework does not know what an organization is. Like `MediaLibraryScope`
and the `organisationId` in `AppNavigationContext` today, a scope is an opaque
`{ type, id }` that the host has already authorized. The host gives the
Settings app one function that answers "may this actor edit this scope?", using
its own `OrganizationMember` roles. db3.ai and GrowthScout both have that table
already.

GrowthScout has a fourth level that iOS has no answer for: settings per
**website** (`WebsiteVisibilitySettings`, `Website.articleSettings`). The host
could declare its chain as `install > organization > website > user`, so those
could move to settings too. That is decision 2 below.

Install-level values are per environment, because each environment has its own
database. Checked-in config stays the place for per-environment defaults;
install settings are runtime overrides a super user makes without a deploy.

## Storage

One table, owned by the settings service, stores only overrides. A row exists
only when someone changed a value away from its default; "Reset to default"
deletes the row.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | ulid | Primary key |
| `app` | string(64) | Owning app id, for example `scout` |
| `scope_type` | string(32) | `install`, `organization`, `user`, or a host scope |
| `scope_id` | string(64) | Empty for `install` |
| `key` | string(64) | Setting name |
| `value` | json | Validated by the declared field before save |
| `updated_by` | string(64) | Actor id, for an audit line on the screen |
| `updated_at` | timestamp | |

Unique on `(app, scope_type, scope_id, key)`, so a save is a single upsert and
needs no transaction. A setting removed from code leaves its rows unread; a
`settings:prune` command can delete them.

## Caching

Caching is a later luxury, not part of the first build. Without a cache,
settings read the table directly: at most one indexed query per scope per
request.

The problem found in review: the default cache keeps values in each process's
own memory. A web process that saves a setting sees it at once, but a queue
worker keeps its old copy. Rather than have settings poll for changes, the fix
belongs in the cache service.

**Stores declare their reach.** The driver sets it, so config cannot claim the
wrong one. A service states the reach it needs and refuses a store that falls
short, with a clear error at boot. In-process stays valid for things like
parsed templates.

| Driver | Reach | Who sees the same value |
| --- | --- | --- |
| `memory` | `process` | One process |
| `file` (new) | `machine` | Every process on that machine using the same folder |
| `redis` (works with Valkey today) | `shared` | Every process, on every machine |

**File driver**, modelled on Yii 2's `FileCache`: one file per key, named by a
hash of the key and spread over subfolders; the file's modified time is the
expiry, so a stale entry is rejected without being parsed; an occasional sweep
deletes expired files. Writes go to a temp file and are renamed into place, so
a reader never sees half a file. In k3s, pods share a file cache only when
they are on the same machine and mount the same folder, hence `machine` reach.

**Settings names its store** in config, and writes the fresh value into it on
every save, so there is no delay:

```ts
cache: {
	default: 'local',
	stores: {
		local: { driver: 'memory' },
		files: { driver: 'file', path: 'storage/cache' },
	},
},
settings: { cache: 'files' },   // or false: read the table every time
```

Considered and set aside for now:

- **MariaDB MEMORY table as a cache.** TEXT and BLOB in MEMORY tables arrive in
  MariaDB 13.1/13.2, both still preview builds in November 2026; db3 runs
  12.3. MEMORY tables also lock the whole table on write, cap each table's
  size and lose everything on restart.
- **`database` driver on an ordinary table.** Works today and has `shared`
  reach without Valkey. Build it when something needs that.

## Reading settings in code

Code asks for a view bound to the request's authorized scopes, then reads typed
values. The view is built per request and never stored on an app singleton, the
same rule navigation follows.

```ts
// In a route, after the host has authenticated and authorized the organization
const settings = app().settings.for({ organization: org.id, user: actor.id });

const day = await settings.get('scout', 'reportDay');             // stored value, else declared default 'monday'
const size = await settings.get('scout', 'pageSize', 20);          // 20 when nothing is stored or declared
const all = await settings.app('scout');                           // every scout setting, resolved

// Background job with no person: organization and install only
const orgSettings = app().settings.for({ organization: website.organizationId });

// Writes go through the same validation and the host's permission check
await settings.set('scout', 'reportDay', 'friday', { scope: 'user', actor });
await settings.reset('scout', 'reportDay', { scope: 'user', actor });
```

`get()` never throws for an unset value. It returns the stored value, else the
declared default, else the default passed to `get()`, else `undefined`. Most
people never open an app's settings, so almost every read lands on a default.
The declared default wins over the call-site one so the screen and the code
always agree; the call-site default covers a key read before anyone declared
it, which the screen does not show.

## The Settings app: API and rendering

The Settings app renders every app's settings from the declarations, so no app
writes a settings screen. It looks like iOS Settings: a list of apps with an
icon each (from `manifest.json`), then that app's groups as sections of rows.

- **Scope tabs** at the top: My settings, Organization, Install. A tab appears
  only when the viewer may edit that scope and at least one setting allows it.
- **Each row** shows the field, its hint, and where the current value comes
  from: "Default", "Set by Acme", or "Set by you". A row with an override gets
  "Reset".
- **Locked rows**: when a setting is not editable at the current tab, it shows
  read-only with its effective value, so a person sees why their report goes
  out on Monday.
- **`showIf`** hides dependent rows, as neon did.

Two routes, both behind the host's session and permission check:

| Route | Returns or does |
| --- | --- |
| `GET /settings/:scope` | Every app's groups, field component specs, effective values and value sources for that scope |
| `PATCH /settings/:scope/:app` | Validates and saves changed keys; `null` resets a key to the inherited value |

An app can also embed one group in its own page (for example GrowthScout's
website settings tab) with a `<SettingsGroup app="scout" group="publishing" />`
component, so values stay in one place even when edited from elsewhere.

## Decisions

1. **Where it sits — decided 10 November.** Two layers. The settings API
   (`app().settings`, `defineSettings`, the table) is part of the framework, so
   any code can read and write settings. The Settings app is the provided admin
   area, like iOS Settings: every new project gets it from `create`, and any
   app's registered settings appear there without the app writing a screen. A
   project that wants something different ejects the app's code into its own
   `apps/settings/` and changes it; the API underneath stays the same.
2. **Scope chain — open.** Recommended: the framework ships
   `install > organization > user`, and the host may insert its own levels,
   such as GrowthScout's `website`. The alternative is a fixed three-level
   chain, which leaves GrowthScout's per-website settings in their own tables.
3. **Cache — open, direction agreed.** Steve asked for caches that declare
   per-process or shared, a file cache, and settings config naming its store.
   The shape in "Caching" above awaits his go-ahead.

Proposed build order once agreed: `reach` on cache stores, the `file` driver,
then settings with contract tests first (declaration, resolution order,
validation, permission refusal, cache write-through), built in the starter and
adopted in GrowthScout's mail and article settings as the first real user.

## Later, in the same admin area

The Settings app is where other per-app controls can land without each app
building UI. None of these are in v1, but the declaration leaves room for them
as new entry kinds beside `settings`:

- **Experimental features**: a boolean setting marked `experimental`, shown in
  its own Labs section, read with the same `get()`.
- **AI access**: "Grant the AI access to this section", a per-app permission
  the AI agents service checks before an agent reads or changes that app's
  data.
- **Account**: the shared Account app (sign-in, connected accounts, sessions)
  could be the top row of Settings, as an Apple account is on iOS, instead of
  a separate area.
