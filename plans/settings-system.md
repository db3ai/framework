# Settings system: implementation plan

**Proposed implementation, revised 14 November 2026.** This records the design
agreed in the settings review. The APIs below are proposed; they are not shipped
framework behaviour. This revision supersedes the
[initial settings proposal](https://github.com/db3ai/framework/blob/ab6302099c1ce46df1598b2b8ca8421a03e55cc3/plans/settings-system.md).

## Purpose and ownership

Provide one generic place for apps and services to define, store, read and edit
settings. Common definitions drive the code helpers, validation, defaults,
serialization/encryption and the shared Settings UI. Adding a setting normally
means adding its key and definition, with no database migration or bespoke
settings form.

The persistence underneath is a durable, scoped key/value store backed by the
configured cache. The database is authoritative. Reads check the cache first
and load missing values from SQL; writes persist to SQL before updating the cache.

Keep the framework addition small: a service-owned `settings/` module, one lazy
application service, importable helpers, one table, and the cache operations
needed to support them. Applications decide which configuration can be
overridden and when to read it to construct or refresh a service.

Database configuration and the encryption key are available before settings is
used. Settings must be lazy enough that migration and help commands can run
before its table exists. Boot configuration continues to be assembled explicitly
using `env()` and configuration defaults.

The dependency order is:

```text
Environment and shipped configuration
	-> database and encryption setup
	-> settings lookup
	-> application-owned service initialization or operation
```

## Shared definitions and consistent handling

Each sub app can override a synchronous `settings()` method on its root
`SubApp`. The base implementation returns an empty definition, so an app
with no settings needs no additional code. The method returns schema/metadata
for the settings the app uses, not their current saved values.

For example, the proposed hook for an app with manifest ID `publishing` is:

```ts
import { SubApp } from '@db3.ai/app/apps';
import { field } from '@db3.ai/app/settings';

/** Provides the publishing feature and its settings declarations. */
export default class PublishingApp extends SubApp {
	/**
	 * Declares the fields the common Settings UI can edit for this app.
	 * @returns App-local keys, their fields and the scopes allowed to override them.
	 */
	override settings() {
		return {
			autoPublish: {
				field: field.boolean({
					label: 'Publish automatically',
					default: false,
				}),
				scopes: ['organization'],
			},
		};
	}
}
```

The framework collects these definitions from enabled apps and derives each
namespace from the app's manifest ID. The example exposes
`publishing.autoPublish`; it does not create a `publishing_settings` table or
add a settings column to an app-owned model. An app may delegate its method to
a local definition module for organization, without an extra host registration
step or mandatory separate `settings.ts` discovery convention.

Collect declarations before an app's startup hook needs their defaults or
codecs. Keep the metadata independent of the viewer and free of SQL reads,
provider calls or other startup side effects. Resolve authorized scope and
effective values separately for each operation.

The shared registry describes the keys, fields and validation, defaults or
configuration references, allowed scopes, display groups and safe codecs.
Framework services can contribute through the same contract under a stable
service namespace. Namespace providers can also describe dynamic keys.

The same resolver and write pipeline serve ordinary server code and the Settings
UI. A form save uses the same scope checks, validation, encoding, persistence and
cache updates as `setSettings()`. Adding a declared setting makes it available
to the common editor without an app implementing its own persistence endpoint
or full settings screen.

The delivered feature includes the shared Settings UI as well as the storage
and helpers. Core storage remains independently testable and can also hold
internal dynamic keys that an app does not expose in that UI.

## Public API

Provide the helpers through `@db3.ai/app/settings`:

```ts
import {
	setting,
	getSettings,
	setSetting,
	setSettings,
	resetSetting,
	orgSetting,
	userSetting,
} from '@db3.ai/app/settings';

const scope = { organization: organization.id };

const diskName = await setting(
	'backups.disk',
	app().config.get('backups.disk', 'local'),
	{ scope },
);

await setSetting('backups.disk', 'archive', { scope });

await setSettings({
	'branding.name': form.name,
	'branding.logo': form.logo,
	'mail.from_name': form.fromName,
}, { scope });

const values = await getSettings([
	'branding.name',
	'branding.logo',
	'mail.from_name',
], { scope });

await resetSetting('backups.disk', { scope });
```

- `setting(key, fallback?, options?)` returns a decoded override, the supplied
  fallback when absent, the declaration's default when no fallback was supplied,
  or `undefined`. An unset value is not an error. UI definitions reference the
  same configuration defaults used by application code.
- `getSettings(keys, options?)` resolves an explicit set of keys in bulk through
  the same resolver. Declaration defaults apply to absent overrides; keys with
  no override or default resolve to `undefined`. Defaults are applied outside
  the raw cache.
- `setSetting` and `setSettings` are explicit writes. Reading with a fallback
  never writes that fallback to storage.
- `resetSetting` deletes an override. `null` remains a valid stored value where
  the setting's validator permits it; it is not a reset instruction.
- `orgSetting` and `userSetting` are read conveniences over the same service.
  Write helpers take explicit scope, including scope resolved by the host UI.

Use a namespace-qualified public key such as `backups.disk` or
`scout.website:site_42:article_settings`. The namespace identifies the owning app
or service. Its code owns the remaining key format, including embedded resource
IDs. Generic server code may use dynamic keys; UI exposure requires an owning
declaration or namespace provider.

Every explicit set persists an override, including values equal to the current
default. Presence, rather than truthiness, determines whether a value exists.
Ordinary JSON values are supported; `undefined` is reserved for absence.

## Scope and context

An omitted scope means installation-wide. Support these optional identifiers:

| Scope | Meaning |
| --- | --- |
| `{}` | Installation-wide value |
| `{ organization: id }` | Shared organization value |
| `{ user: id }` | Global user preference |
| `{ organization: orgId, user: userId }` | User preference within one organization |

Only the requested dimensions participate in identity. A signed-in user does
not automatically turn an organization setting into a per-user setting.
Other resource IDs can be part of the owning service's logical key.

The host can register a context resolver during setup. The resolver runs inside
the current request, using the existing isolated `RequestContext`, after the
host has authenticated the user and authorized the selected organization.
The setup hook stores resolver functions, never the current request's IDs on a
shared singleton.

`orgSetting()` requires a resolved organization and ignores user overrides.
`userSetting()` uses the user scope defined for that declaration or host: global
user preferences and organization-member preferences must be explicit choices.
Missing required context raises a context error instead of falling back to a
different owner. Jobs and startup code can supply explicit scope.

Core storage resolves an exact identity. Where the Settings UI or an application
needs inheritance, declare an ordered fallback chain, for example
organization+user -> organization -> install -> configuration default.
Do not silently drop arbitrary identifiers or invent inheritance for every key.
A provided call-site fallback is honoured; UI declarations should reference the
same configuration source so there are no competing static defaults.

Organization models, memberships, roles and organization selection stay with
the host. The separate tenancy investigation may later supply a reusable context
provider. Settings must work without that work or any organization model.

## One database table

Use `db3_settings` with this logical schema:

| Column | Purpose |
| --- | --- |
| `key` | Unique primary key, containing the canonical namespace-qualified key and exact scope |
| `namespace` | Stable owning app or service; also supports namespace listing |
| `organization_id` | Optional organization identifier, indexed for listing |
| `user_id` | Optional user identifier, indexed for listing |
| `value` | Opaque text produced by the setting's serializer/field codec |

There is no separate ULID, JSON context document, context hash, encryption flag
or separate ciphertext column. The public key is local to its scope; one central
key builder produces the globally unique storage key and cache identity.
It must encode key/scope boundaries unambiguously and reject overlong keys.
Store namespace and scope metadata from that same normalized input.

Making the complete storage key the primary key avoids nullable composite-index
uniqueness problems. Optional ID columns remain directly queryable and do not
reference framework-owned organization or membership tables.

Listing by organization includes both shared organization values and its
per-user values. A shared-only listing also filters `user_id IS NULL`. Listing
by user can include their global preferences and values in organizations they
belong to. Any HTTP exposure remains host-authorized.

Exact primary-key lookups are the primary access pattern. Bulk reads query the
requested canonical keys together. Rare administrative listings use the
namespace and scope indexes. A form is normally populated from its declarations
and `getSettings`, rather than scanning the whole settings table.

## Configured cache

Settings selects a named store from the framework cache configuration. Redis is
the intended shared store for multiple workers or machines. Add a file driver
for smaller sites whose processes share the same physical cache directory.
Memory remains appropriate for an explicitly single-process setup.

Small cache-service additions are needed: named-store access, bulk get/set/delete
operations, the file driver, and sharing metadata describing process/machine/shared
reach. File sharing depends on the actual mounted directory; a path string
alone cannot make independently stored pod files shared.

The file driver needs safe hashed filenames, atomic replacement, expiration and
bounded cleanup. Settings does not add an independent process-local value cache
in front of a selected shared store.

| Operation | Flow |
| --- | --- |
| Read | Cache -> database on miss -> populate cache -> decode value |
| Write | Validate/encode -> database commit -> update cache |
| Reset | Database delete -> cache invalidation |
| Bulk read | Batch cache lookup -> one SQL lookup for misses where practical -> batch cache population |
| Bulk write | Validate/encode all -> persist together -> refresh affected cache entries |

Cache identities include application/environment isolation and the complete
setting identity. Cache only stored encoded values or an explicit absence marker,
never a caller's config fallback, viewer permissions or decrypted credentials.
Negative cache entries expire and are replaced or invalidated on writes.

SQL and the cache cannot be committed atomically. V1 provides eventual cache
consistency, with a finite configurable TTL to recover from failed refreshes and
overtaken reads/writes. It does not promise that every process observes a commit
immediately. A cache outage falls back to SQL. Database/decryption failures are
errors, not missing values that silently select a fallback.

A mutation result distinguishes durable database success from cache refresh
degradation. Cache failure after commit must not be reported as though SQL was
rolled back. Diagnostics contain safe identities/status, never secret values.

## Bulk saves and connection settings

Validate and encode the complete submitted batch before persisting anything.
Use one atomic bulk upsert when practical. If a batch also resets keys or needs
multiple SQL statements, use a short transaction with the explicit invariant
that the submitted form must not persist only some of its changes. Keep cache
operations and external provider calls outside that SQL boundary.

A database batch is atomic; refreshing multiple cache keys is not an atomic
snapshot on every driver. Store tightly coupled integration options, such as an
S3 driver/bucket/credential configuration, as one validated JSON value when they
must be consumed together. The same value can be encrypted as one payload.

Bulk batch size and payload size are bounded. Chunking large batches must retain
the promised durable atomicity or be exposed as an explicitly different operation.

## Field declarations, secrets and Settings UI

Use the shared registry for namespace-owned labels, groups, defaults/config
references, allowed scopes, validation, safe display metadata and
serialization/encryption codecs. Code reads and the Settings UI use these same
definitions and resolution rules. Keep the generic store usable independently
of a form as the underlying persistence service.

Reuse field behaviour through a supported adapter, after proving strict input
validation. Existing choice fields can normalize invalid input to a default;
settings submissions must reject invalid choices before such coercion. Existing
model fields import server code. Keep declarations/validation on the server and
send only safe form specifications to the browser.

A secret field serializes encrypted payloads through `app().security`. Bind
encryption to the setting's complete identity, so ciphertext cannot be moved
between owners or keys. Decode only at the owning server boundary; cache and
SQL hold the encoded representation. The database does not need to know which
values are encrypted.

The editor displays approved metadata and secret status, with explicit replace
and reset actions. It never sends the existing secret back. Distinguish reset
(inherit/fallback) from disabling an integration; removing one override must not
silently imply that a parent credential is disabled.

Ship the declaration-driven Settings app with new projects and allow it to be
customized/ejected, as originally intended. Give it a distinct internal app ID,
such as `settings_admin`, so it cannot collide with `app().settings`.
Host policies authorize scope/key reads and writes; navigation visibility and
`showIf` are presentation behaviour, not permission checks.
The editor groups settings by their owning app/service, offers the scopes the
viewer may manage, shows effective values/defaults, and supports bulk save and
explicit reset through the common service.

Applications continue to construct ordinary services using resolved values.
Reading settings at startup means changes apply at the next restart or explicit
service rebuild. Reading per operation lets subsequent operations see updated
configuration according to the cache freshness contract. Shared service instances
must not retain one request's tenant state.

## Implementation sequence and verification

1. Implement the service contracts, canonical identities, JSON codecs, one
   table, individual/bulk helpers and exact-scope behaviour with behaviour tests.
2. Add named/bulk cache support, Redis integration and the shared-directory file
   driver; verify SQL-first writes, cache misses and degradation behaviour.
3. Add the optional `SubApp.settings()` hook and automatic collection, trusted
   request-context helpers, field adapters and safe declarations. Verify apps
   with no settings, namespace ownership, scope isolation, strict validation and
   encrypted round trips.
4. Build the provided Settings UI in the starter/Create flow, exercising real
   framework services and the host's authorization policy.
5. Adopt one small real settings group, then application-owned integration
   configuration. Refresh and verify each consumer's packed framework artifact
   explicitly when adopting the change.

Behaviour tests cover concurrent request isolation; global/organization/member
identity; canonical-key collisions; direct owner listings; false/zero/empty/null
values; explicit overrides equal to defaults; bulk validation/SQL partial failure;
reset and absence caching; differing caller fallbacks; cache outage and overtaken
fills/writes; encoded secret storage; wrong-owner decryption; and form permission
refusal. Use disposable SQL databases, real Redis/file drivers where their
behaviour is asserted, and isolated cache directories/namespaces.

Verify installed imports and types through the packed-package gate. Complete
the repository's required checks for the implementation:

```sh
npm run check
npm test
npm run test:release
npm run framework:package:test
npm run docs:build
```

The tenancy investigation runs in its own chat and is not a prerequisite for
these settings milestones. Broader tenant models/query filtering and application
service refresh strategies belong to their owning work.
