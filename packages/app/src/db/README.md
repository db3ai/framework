# ActiveRecord + FieldType

This DB layer is a FieldType-centred ActiveRecord system. A model field is not
only a database-column description; it owns the lifecycle of one logical value
as it moves between request/input data, app memory, storage, and display/API
data.

## Define an inferred model

Prefer `ActiveRecord.define()` for new models. Declare fields once and infer model properties
and constructor/`create()` inputs. Extend the returned class with ordinary
instance and static methods. The [user example](examples/DefinedUser.ts) is a
complete model with an inferred email property and a domain method.

```ts
import { ActiveRecord } from '@db3.ai/app/db';

class User extends ActiveRecord.define({
	table: 'users',
	fields: field => ({
		id: field.ulid({ primary: true }),
		email: field.email({ required: true }),
	}),
}) {}

const user = User.create({ email: ' USER@EXAMPLE.COM ' });
// user.email is string | null, with the value 'user@example.com'.
// create() returns immediately; the row is not saved yet.
await user.save();
```

Configure the active application and table before saving, as described below.
`define()` itself performs no database work and does not generate migrations.

`class Admin extends User { ... }` retains inferred fields. `User.define({
fields: field => ({ ... }) })` adds another layer, including all inherited
fields. The normal `create()`, query, lookup, hydration and `useDb()` statics
retain their actual receiver type, including methods added by later subclasses.

A matching field name replaces the entire inherited definition, so repeat any
configuration you still need. TypeScript requires overrides to preserve the
application and input value types, protecting methods inherited from the base.
Fields cannot replace existing non-field public instance members. Other settings
inherit unless supplied, including table, primary key, request guards and soft
deletes. Define a new root model if a field needs a different value type.

Factories use the existing builder and accept field instances, field classes,
and `{ type, config }` definitions. Field metadata is resolved per model; each
record clones and binds its own live fields. Cloneable literal defaults, such
as JSON objects and arrays, are copied for each record. Use default factories
for custom objects that cannot be copied safely. Values explicitly assigned by
reference retain the existing field's parsing and reference semantics.

Properties describe application values. `required: true` is a runtime validation
rule and does not remove `null` from a field's TypeScript value. Inputs use the
field's existing `TInput`: many built-in fields intentionally accept `unknown`.
For example, password properties read as `null`; provide plaintext through
`create({ password })`, the constructor, or `assign({ password })`. Property
writes use the same field setter at runtime, but TypeScript checks them against
the application value type. `assign()` and request filling retain their existing
dynamic input behavior. JSON generics do not validate nested input shapes.

`ActiveRecord.InferInput<typeof User>`, `InferValue`, `InferDbRow` and
`InferDisplay` work with the complete composed field map. Constructor and
`create()` input fields are optional because records may be filled before
validation or saving. Unknown keys in object literals are rejected by these
typed constructors; runtime request filling still follows the existing policy.
The concrete field map remains available through `typeof User.fields`.

Existing `class User extends ActiveRecord` declarations remain supported, and
can be extended with `define()`. Their static `fields()` overrides keep their
existing behavior: use `...super.fields(field)` to include parent definitions.
Dynamic field maps retain runtime behavior but cannot infer names unknown to
TypeScript. The typed instance `getField()` API is not part of this change;
`getBoundField(name)` continues to return the existing live field.

## Start With Workspace Notes

The [note model](examples/KnowledgeNote.ts),
[scoped operations](examples/workspaceNotes.ts), and
[transaction example](examples/createNotesTogether.ts) show the normal workflow:
define fields, fill permitted request values, assign trusted ownership, save,
query, update and delete. `Model.create()` returns an unsaved record; call
`save()` to persist it.

The [executable lab](examples/runWorkspaceNotes.ts) creates a disposable database,
asserts workspace scoping, validates input, checks rollback and removes its
database afterwards. Copy all four files into one directory, configure a TCP
MariaDB/MySQL test account with CREATE/DROP DATABASE permission, and run the lab
with `tsx`. The [expected result](examples/outputs/workspace-notes.json) is also
asserted by the service-owned example tests. The db3.ai workspace notes guide
provides the full package-install and environment commands.

The lab uses `Database.install()` only to bootstrap its disposable schema. Real
applications use committed migrations. The workspace argument must already be
authorized by the host application; a fillable list is not authentication.

## Run fields and migration changes

After [Installation](https://db3.ai/docs/installation) and local MariaDB test-account setup, copy the shipped SQL labs into your app:

```sh
mkdir -p examples
cp -R node_modules/@db3.ai/app/src/db/examples/. examples/
npx tsx examples/runFieldNotes.ts
npx tsx examples/runNoteMigrations.ts
```

Use Node.js 24, MariaDB and credentials allowed to create/drop generated `db3_app_test_*` databases. `DATABASE_URL` takes precedence over individual `DB_*` values; unset it when targeting a different test server. Each lab owns and cleans up a new database. The migration lab also owns a temporary source directory. Neither modifies your existing app schema or key.

The [Fields walkthrough](https://db3.ai/docs/fields) demonstrates a reusable uppercase code field, normalized tags, nested JSON, ownership protection and hidden encrypted storage. Expect `BRIEF-1`, `["SEO", "Agency"]` and true protection flags. JSON generics describe types but do not validate nested shapes.

The [Migrations walkthrough](https://db3.ai/docs/migrations) creates a note, refuses an unsafe required column without changing source, then applies a nullable replacement and checks the original data remains. This is the tested foundation for a real app's make/review/migrate/check workflow, not boot-time schema synchronization.

`databaseCommands` from `@db3.ai/app/db/commands` registers `db:migrate`,
`db:check` and `db:make-migration` through the shared [framework CLI](../cli/README.md).
Each action has its own file under `db/commands/` and uses `app().db.migrations`.
Supply only the model registry with `dbOptions: { migrations: { models } }`.
The database service uses `server/database/migrations/` and
`server/database/schema.snapshot.json` under `app().directory`, supplies the
connection and dialect, and lazily creates the manager. No app-owned
`migrations.ts` configuration file or migration path settings are needed.
Register the command array in `server/cli.config.ts`.

The app directory defaults to the working directory when `new App()` runs.
The starter anchors it with `directory: new URL('../', import.meta.url)` in
`server/app.ts`, so importing the app from elsewhere still uses its own files.
The low-level `DatabaseMigrationManager` retains explicit paths for standalone
tooling and disposable migration labs; app service paths follow the convention.

The exported `migrate()`, `check()` and `makeMigration(options)` functions return
ordinary results for application or authorized UI handlers in an existing app
context. Commands retain the manager's validation, production restrictions and
source-generation rules. The CLI owns startup and shutdown; direct action
callers retain ownership of their app. App migration files and model registries live
under `server/database/`.

Copy the exact website tests to `tests/db/runFieldNotes.test.ts` and `tests/db/runNoteMigrations.test.ts`, then run:

```sh
npx vitest run tests/db/runFieldNotes.test.ts tests/db/runNoteMigrations.test.ts
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck examples/*.ts
```

Full references: [Fields](https://db3.ai/docs/fields-api), [record/query APIs](https://db3.ai/docs/active-record-api), and [migration contracts](https://db3.ai/docs/migrations-api). [Transactions](https://db3.ai/docs/cookbook-transactions) and [encrypted model values](https://db3.ai/docs/cookbook-secrets) reuse these same models and tests.

## Database Connections

The database environment helper reads the driver from loaded process settings; the Config service does not automatically reconfigure a connection. Use `DB_CONNECTION` with `mysql`, `mysql2`, or
`mariadb`. Both MySQL and MariaDB currently use Knex's `mysql2` client; the
dialect decides driver-specific schema and value conversion.

```env
DB_CONNECTION=mariadb
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=db3_app
DB_USER=root
DB_PASSWORD=
```

Postgres names (`postgres`, `pgsql`, `pg`) are reserved in the dialect resolver,
but require the `pg` dependency and pgvector-specific verification before being
used in production.

## Generated Database Migrations

`DatabaseMigrationManager` turns an application's complete ActiveRecord model
registry into permanent Knex migrations. The application supplies absolute
paths for its migration directory and committed schema snapshot, plus its own
migration-ledger table name. CLI commands, development HTTP actions, and deploy
automation should be thin adapters around that one configured manager.

The intended command contract is:

- `db:make-migration` compares current models with the committed snapshot,
	writes one reviewable Knex migration for supported changes, and advances the
	snapshot. Nullable columns, required columns with static defaults, ordinary
	non-unique indexes, and static default changes are generated automatically.
	Required columns without defaults and constraints that depend on existing
	data remain blocked for an explicit data-aware migration.
- `db:migrate` applies pending committed migration files through Knex's ledger
	and migration lock. It does not inspect models or generate source files.
- `db:check` requires models to match the committed snapshot, no migration
	files to be pending or missing, and the live model-owned database subset to
	satisfy current models. Extra tables and columns and database comments are
	ignored so additive blue/green deployments and comment-only legacy differences
	remain compatible. Physical index names and definitions must still match the
	canonical snapshot so future migrations can address them safely.
- `db:sync` is a development convenience that runs make, migrate, and check
	through the same service.

Generation is protected by a cross-process source lock and is refused in
production. A blocked or unsupported model difference is reported for explicit
review rather than being silently emitted. Generated migrations and the schema
snapshot are source-controlled deployment inputs; production applies them but
never creates or rewrites them.

Never edit a migration after it may have been applied. The Knex ledger records
filenames, so changing an applied file cannot run the new DDL; restore the frozen
file and add a new forward migration instead.

When a baseline-enabled migrate or development sync adopts the sole initial
migration, it may baseline an existing untracked database only when its
model-owned schema is runtime-compatible with the initial snapshot. Comments do
not block adoption, but missing, renamed, or incompatible tables, columns,
indexes, and foreign keys do. A partial or incompatible database fails instead
of recording a migration that did not actually run.

Committed snapshots and generated migrations still retain canonical comments.
The comment tolerance applies only when projecting a live database for
compatibility checks and initial baselining; it does not remove metadata from
migration generation or source-controlled schema history.

Normal API, worker, and scheduler startup must not perform schema work. This
keeps startup deterministic and prevents application replicas from racing to
modify the database. `Database.install(...)` remains a low-level, non-versioned
bootstrap utility for framework tests and disposable databases; it is not an
application deployment strategy or a substitute for committed migrations.

## Application Backups

Applications can attach their own dump and storage policy to the database
service, then invoke it through the same active app shape used by other database
work:

```ts
app().db.setBackupHandler(request => databaseBackup.create(request));

const manifest = await app().db.backup<DatabaseBackupManifest>({
	backupId,
	createdAt,
	trigger: 'manual',
});
```

The framework deliberately owns only the `backup()` invocation seam. The
application remains responsible for selecting a logical or physical dump,
storage destinations, retention, locking, and restore verification. Calling
`backup()` without an application-provided handler fails explicitly.

## Field Lifecycle Types

Every `FieldType` uses this generic shape:

```ts
FieldType<TValue, TDbValue = TValue, TDisplayValue = TValue, TInput = TValue>
```

- `TInput`: values `setValue()` can accept. This is the boundary for app code
	and request filling.
- `TValue`: hydrated backend/app value used by model properties.
- `TDbValue`: raw storage value read from or written to the database.
- `TDisplayValue`: value returned for frontend forms, API transport, and JSON.

The standard lifecycle methods are:

- `setValue(input)` converts `TInput` into `TValue`.
- `setFromDb(dbValue)` converts `TDbValue` storage into `TValue`.
- `toDbValue(value)` converts `TValue` into storage.
- `toDisplayValue(value)` converts `TValue` into frontend/API-safe data.

`toJSON()` is a transport alias for display data. Use `toAppData()` when code
wants hydrated backend values.

## Request Filling

Fields do not own request keys. The model/request boundary owns how a specific
payload maps into logical model keys.

```ts
class Website extends ActiveRecord {
	static override requestGuarded = ['user'];

	static readonly onboardingRequestMap = {
		website: 'url',
		business: 'businessName',
		audiencePhrases: 'targetAudiencePhrases',
		competitors: 'competitorWebsites',
	} satisfies ActiveRecordRequestMap;
}

const website = new Website();

website.setFromRequestWithMap(request.body, Website.onboardingRequestMap);
website.assign({ user: currentUser });
```

Use:

- `assign(input)` for trusted app/internal values keyed by model field name.
- `setFromRequest(data)` for request/form values keyed by model field name.
- `setFromRequestWithMap(data, dataToFieldMap)` for endpoint-specific payload
	keys.

Request filling skips primary and generated fields by default. It also respects
model-level `requestFillable` and `requestGuarded` settings. Protected fields
such as ownership links should stay guarded and be set from trusted app code.

## Validation

Validation is available outside models through `@db3.ai/app/validation`.
The full guide lives in
[`packages/app/src/validation/README.md`](../validation/README.md).

```ts
import { validate } from '@db3.ai/app/validation';

const result = validate(request.body, {
	email: ['required', 'email'],
	age: ['nullable', 'integer', 'min:18'],
});

if (!result.valid) {
	return reply.status(422).send({ errors: result.errors.map(({ field, rule, message }) => ({ field, rule, message })) });
}
```

Supported first-party rules include `required`, `nullable`, `string`, `number`,
`integer`, `boolean`, `email`, `url`, `array`, `object`, `min`, `max`,
`minLength`, `maxLength`, `in`, `regex`, `ulid`, and `uuid`.

Models can generate request-level validation rules from their fields:

```ts
const rules = Website.validationRules();
const result = validate(request.body, rules);
```

Field validation still exists for record persistence (`record.validate()` and
`record.save()`), but request-level validation can now happen before a live
model is populated.

## Projections

Use `ActiveProjection` for joined or read-model shapes that are not one
persisted model row.

```ts
class ContentPlanItemProjection extends ActiveProjection {
	static override fields(field: ProjectionFieldBuilder) {
		return {
			...field.fromModel(ContentPlanItem),

			keywordSearchVolume: field.from(Keywords, 'searchVolume', {
				alias: 'keyword_search_volume',
				default: 0,
			}),
		};
	}
}
```

`field.from(Model, key)` reuses the source model field conversion. `alias` is
only needed when the query renames the source column; otherwise the source field
already knows its storage column.

Projection rows hydrate through fields and expose:

- `toAppData()` for hydrated backend values.
- `toDisplayData()` for frontend/API-safe values.
- `toJSON()` as a transport alias for `toDisplayData()`.

Keep the join query on the projection class when the projection represents a
specific app read shape.

## App Data

For ordinary model reads, prefer the field-aware ActiveRecord query API:

```ts
const keywords = await Keywords
	.where('website', websiteId)
	.orderBy('searchVolume', 'desc')
	.all();

return keywords.map(keyword => keyword.toDisplayData());
```

Use logical field names in these queries. The model field owns the mapping from
`website` to `website_id`, `searchVolume` to `search_volume`, and so on.

Avoid repeated route/model cleanup such as `stringValue()`, date conversion,
JSON parsing, array filtering, lowercasing, and URL normalisation when a field
already represents that lifecycle.

For bounded read models and frequently refreshed endpoints, use `select()` with
logical field names so the database returns only the columns the caller needs.
Use `count()` when only the number of matching records is required; it executes
the aggregate in the database without hydrating model rows.

```ts
const progress = await WebsitePage
	.where('website', websiteId)
	.select('analyzeStatus', 'analyzeData')
	.all();

const keywordCount = await Keywords
	.where('website', websiteId)
	.count();
```

## JSON Fields

Use `field.json<T>()` for permissive JSON storage. It accepts decoded values or
JSON strings, keeps the decoded value in app memory, and serialises the value
when writing to the database.

```ts
metadata: field.json<Record<string, unknown>>({
	column: 'metadata',
})
```

Use `field.encryptedJson<T>()` for JSON-compatible credentials and secrets that
the application must decrypt later. It stores versioned authenticated
ciphertext in a long text column, is always hidden from model JSON, and cannot
be queried directly. Encryption is provided by the active app's central
`app().security` service. Sensitive fields should normally opt out of default
selects and be loaded only by the server workflow that needs them.

```ts
blogIntegration: field.encryptedJson<BlogIntegration>({
	column: 'blog_integration',
	selectedByDefault: false,
})
```

See [../security/README.md](../security/README.md) for key configuration,
payload behavior, and operational requirements.

Specialised JSON fields should build on that lifecycle instead of reimplementing
schema and JSON conversion. `field.stringList()` stores a normalised string
array. `field.vector({ dimensions })` stores an embedding/vector as native
database vector storage while keeping a finite `number[]` in app memory. MySQL
writes native vector bytes, while MariaDB writes through `VEC_FromText(...)`.
On dialects with native vector-index support, required vector fields create a
vector index by default. Nullable vector fields are storage-only by default
because MariaDB vector indexes cannot include nullable columns. Vector fields
are omitted from normal ActiveRecord fetches; use
`Model.query().withField('embedding')` for specialist queries that need the raw
embedding value.

Use `whereVectorSimilarTo()` for dialect-aware nearest-neighbour style queries.
The query builder owns the SQL differences between MariaDB and PostgreSQL, while
the caller supplies the logical vector field and query vector.

```ts
const rows = await WebsiteEmbedding
	.query()
	.where('website', websiteId)
	.whereVectorSimilarTo('embedding', queryVector, {
		as: 'distance',
	})
	.limit(10)
	.toKnex();
```

`field.jsonString<T>()` remains available for older model code and text-backed
JSON columns. Prefer `field.json<T>()` for new arbitrary JSON fields when no
more specific field exists.

## Soft Deletes

Models can opt into Laravel-style soft deletes with `static softDeletes = true`.
The conventional logical field is `deletedAt`; declare it as a timestamp field
so schema sync and model hydration stay field-aware.

```ts
class Post extends ActiveRecord {
	static override softDeletes = true;

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			title: field.string({ required: true }),
			deletedAt: field.timestamp({
				column: 'deleted_at',
				index: true,
			}),
		};
	}
}
```

Default model queries exclude trashed rows. Use `withTrashed()` to include them,
`onlyTrashed()` to inspect deleted rows, `restore()` to clear `deletedAt`, and
`forceDelete()` when the row should be physically removed.

## Custom Fields

When writing a field, implement only the methods that differ from the base
class:

- `createState()` when the field needs custom state.
- `parse()` or `setValue()` for `TInput` to `TValue`.
- `fromDbValue()` for `TDbValue` to `TValue`.
- `toDbValue()` for `TValue` to `TDbValue`.
- `toDisplayValue()` or `getDisplayValue()` for `TValue` to `TDisplayValue`.
- `collectErrors()` or `validate()` for field-level validation.
- `getValidationRules()` for reusable request validation rules.
- `getDbSchema()` for install/sync/migration metadata.
- `getQueryValue()` when query values need conversion.
- UI helpers such as `defaultFormComponent()`.

Prefer normalising invalid input into a stable internal value and reporting
problems through validation errors. Throw from parsing only for programmer
errors or truly unrecoverable input.

## Lock a row during a transaction

Use `forUpdate()` when a read and subsequent update must exclude competing
writers. It delegates to Knex's `forUpdate()` while keeping typed model results:

```ts
await app().db.transaction(async () => {
	const user = await User.where('id', userId).forUpdate().firstOrFail();
	// Read and update protected state here, then save the model.
	await user.save();
});
```

Create the query inside the transaction. `forUpdate()` adds the SQL lock clause;
it does not open a transaction itself. The database releases locks on commit or
rollback, including rollback when the callback throws. A terminated database
connection also rolls back its transaction. Without an explicit transaction,
autocommitted queries do not keep a useful lock across separate operations.
Keep transactions short and avoid email, network requests or user input while
holding locks. Ordinary consistent reads can still read committed state; locks
coordinate competing writes and locking reads, not every reader. Actual lock
scope and supported options depend on the database engine and indexes.

`ActiveRecord.getScopedDb()` exposes only the explicit `withDb` connection, or
`undefined`. It is an infrastructure-adapter seam for transaction participation;
normal model/application code should continue using model APIs and `getDb()`.

## UTC timestamp contract

`TimestampField` uses Date values in memory and ISO UTC strings in JSON. ISO/SQL
datetimes without an offset are interpreted as UTC, independent of the Node
process timezone. Invalid/locale date strings normalize to null and required
field validation still applies. Explicit offsets are honored. This does not
interpret a user's local scheduling form; resolve its timezone before assigning.

The default `db()` connection forces MySQL/MariaDB driver conversion to UTC and
initializes every SQL session to UTC, including DATABASE_URL connections.
PostgreSQL sessions use UTC and their per-client timestamp-without-timezone
parser follows the same UTC convention. Timestamp fields write UTC calendar
components to PostgreSQL timestamp columns, avoiding local Date serialization. Custom/injected Knex connections remain
caller-owned: configure both driver conversion and the SQL session for UTC.
Changing that contract does not repair historical incorrectly encoded values;
inspect and migrate those separately before adopting it in an existing app.
