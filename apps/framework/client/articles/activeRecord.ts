import type { DocArticle, VerifiedExample } from '../docs';
import { serviceExampleSources } from '../generated/service-examples';

/** Complete service-owned files used by both the guide and installed-consumer recipe. */
export const noteExamplePaths = ['KnowledgeNote.ts', 'workspaceNotes.ts', 'createNotesTogether.ts', 'runWorkspaceNotes.ts', 'outputs/workspace-notes.json'].map(name => `packages/app/src/db/examples/${name}`);
export const noteTestPath = 'packages/app/src/db/tests/examples/workspaceNotes.test.ts';
export const noteEvidence: VerifiedExample = {
	description: 'Runs the note workflow against a real disposable SQL database, including validation, workspace isolation, updates, deletion and transaction rollback.',
	testPath: noteTestPath,
	command: `npm test --workspace packages/app -- src/db/tests/examples/workspaceNotes.test.ts --maxWorkers=1`,
	expectedOutput: '6 tests pass; the walkthrough matches its checked-in JSON output.',
	environment: 'Node.js; MariaDB/MySQL test account with CREATE/DROP DATABASE permission; package-owned test settings. No application database is used.',
};

export const activeRecordArticle: DocArticle = {
	id: 'active-record', area: 'services', group: 'Data', label: 'ActiveRecord',
	title: 'ActiveRecord',
	summary: 'Define your fields once. Create, validate, query and save records without repeating database conversion in every endpoint.',
	packageName: '@db3.ai/app/db', sourcePath: 'packages/app/src/db/README.md',
	includeSourceDocument: false,
	examplePaths: [...noteExamplePaths, 'packages/app/src/db/examples/DefinedUser.ts'],
	additionalTestPaths: ['packages/app/src/db/tests/active-record-define.test.ts', 'packages/app/src/db/tests/active-record-define.integration.test.ts'], testPath: noteTestPath, verifiedExample: noteEvidence,
	sections: [
		{ id: 'why-active-record', title: 'Why ActiveRecord?', paragraphs: [
			'Over the last 15 years, I’ve found ActiveRecord to be a good mental model for breaking an application into understandable parts. It isn’t perfect. For larger, more complex systems, I’ll often put a service in front of a group of models to coordinate a workflow.',
			'I’ve built frameworks where almost everything hung off ActiveRecord. Then one developer puts an expensive database operation inside a loop, somebody adds another loop, and a few innocent-looking lines bring the application to its knees.',
			'Here’s the sort of thing I mean, in TypeScript-style pseudocode. This illustrates the problem; it is not a db3.ai relationship or reporting API.',
		], codeSampleId: 'hidden-queries-pseudocode', links: [{ label: 'Skip to the practical guide', articleId: 'active-record', sectionId: 'start-here' }] },
		{ id: 'database-tradeoffs', title: 'The database is still there', level: 3, paragraphs: [
			'If loading each user’s projects runs a query, and every report runs several more, that little loop can trigger thousands of queries. It’s easy to read the code and miss how much work it asks the database to do.',
			'At that point, the whole concept gets blamed. Out goes ActiveRecord; in come resource services, raw queries, a document database or a different ORM. But moving the same database work behind a different abstraction doesn’t make it cheaper.',
			'As with most software engineering, there is no perfect solution. In my experience, ActiveRecord is a great way to rocket through development while keeping things simple and easy to expand. You just can’t forget that there is a database underneath it.',
			'An abstraction several layers above the database can hide performance problems and make database-specific behaviour harder to handle as a system grows. Raw queries everywhere create a different problem: duplicated logic, repeated conversions and inconsistencies. The best answer is often a compromise.',
			'This isn’t trying to be a full object mapper or remove the need to learn a database. Learning a completely abstract system on top of the database can be more work than learning the database itself. Learn the technology you’re using, then build a light abstraction around it. If the abstraction becomes more complicated than the database, you’ve probably gone too far.',
			'That’s the aim here: abstract enough to keep development fast and consistent, and make the application easy to organise and reason about. Keep a database-level escape hatch for the more complex work. ActiveRecord should help you work with the database, not make you forget it exists.',
		], links: [{ label: 'Query methods and the `toKnex()` escape hatch', articleId: 'active-record-api', sectionId: 'query-methods' }] },
		{ id: 'field-first', title: 'ActiveRecord, built around fields', paragraphs: [
			'In some ways, ActiveField would be a better name for the idea. The useful, reusable chunk is the field datatype: it defines how a value moves through the system. ActiveField describes the principle here, not a separate API.',
			'ActiveRecord brings a named collection of fields together and adds queries and persistence. Each FieldType owns how input becomes an application value, how it is validated, how it is stored and loaded, and how it is presented in JSON or a form. The record coordinates those rules; your endpoints shouldn’t have to repeat them.',
			'That puts the behaviour with the datatype, rather than one particular table. PasswordField hashes a password before storage and keeps it out of JSON. EncryptedJsonField encrypts recoverable secrets, such as API tokens, using the app’s configured security service. Declare the same field type on another model and migrate its column. You don’t have to write the conversion and validation again.',
			'The same idea is useful for nested objects and more document-oriented data. JsonField stores nested objects and arrays today, but treats the JSON as one value: it does not automatically validate child fields. Reusable groups of child fields would take this further, but there isn’t a built-in nested-field schema API yet.',
			'This is particularly useful for builders and dynamic applications, where parts of a system are built by another system. If a datatype carries its own rules, the builder has less model-specific code to generate. Define the behaviour once, then reuse it wherever that kind of data appears.',
		], links: [{ label: 'Field lifecycle and custom field API', articleId: 'active-record-api', sectionId: 'field-contract' }] },
		{ id: 'start-here', title: 'Start with a model', paragraphs: [
			'A model represents one database row. Its fields own validation, column names and value conversion. Use model names in your application code: workspace, not workspace_id.',
			'We’ll use a note belonging to a workspace. This page covers the normal data workflow. The linked recipe runs it in an isolated database; the API reference contains the full record and query method signatures.',
		], links: [{ label: 'Run the workspace notes walkthrough', articleId: 'guide-workspace-notes' }, { label: 'ActiveRecord API reference', articleId: 'active-record-api' }] },
		{ id: 'prerequisites', title: 'Before you start', paragraphs: [
			'Your application needs an App instance, a configured MariaDB/MySQL connection and the model’s table. Create the App once during boot. Models resolve its database automatically; feature functions should not take an optional database argument.',
			'Start with your generated application’s existing configuration, model registry and migration commands. The separate workspace-notes lab uses supplied package tarballs and a disposable database.',
			'Use committed migrations for application schemas. `Database.install()` appears only in the disposable example, not in normal server startup. The recipe lists the exact prerequisites and cleanup behaviour.',
		], links: [{ label: 'Set up and run the isolated example', articleId: 'guide-workspace-notes', sectionId: 'install' }] },
		{ id: 'inferred-model', title: 'Infer properties from your fields', paragraphs: [
			'Prefer `ActiveRecord.define()` for new models. It infers properties and constructor inputs directly from the field definitions. Extend the returned class with your application methods. No duplicate `declare` properties are needed.',
			'`DefinedUser.create({ email: "USER@EXAMPLE.COM" })` returns an unsaved DefinedUser immediately. Its email is normalized by the existing EmailField, and `emailDomain()` uses that same live value. Call `save()` to insert it.',
			'Ordinary subclasses keep inferred fields. Further `define()` calls include inherited fields and replace matching definitions completely. Overrides must retain the application and input value types so inherited methods remain safe. Query and creation statics return the actual subclass.',
			'Properties describe application values, such as `string | null`; required validation does not remove null from the type. Constructor and `create()` inputs use the field’s existing input type, often `unknown`. Password properties read as null; supply plaintext through the constructor, `create()` or `assign()`. Existing static `fields()` declarations remain supported.',
		], codeSampleId: 'inferred-user' },
		{ id: 'definition-options', title: 'Configure the model definition', paragraphs: [
			'`define({ fields, ...options })` returns a model class. It does not open a database connection, create a table or generate migrations. You can use the returned class directly, but a named exported subclass gives application models a stable name and a place for methods.',
			'`fields` is required. It receives the usual field builder and returns logical field names mapped to field instances, field classes or `{ type, config }` definitions. Keep that return type inferred; a broad `FieldInputMap` annotation loses the known property names.',
			'Optional model settings are `table`, `primaryKey`, `comment`, `labelFields`, `requestFillable`, `requestGuarded`, `returning` and `softDeletes`. Omitted settings inherit from the base model. `primaryKey` uses a logical field name; field `column` options own SQL names.',
			'Register a host model in `server/database/models.ts`; feature apps use their own model registry. Generate and review a committed migration when the schema changes. Switching definition syntax alone does not require a migration if fields and settings are unchanged.',
		], links: [{ label: 'Migration workflow', articleId: 'migrations' }] },
		{ id: 'inferred-types', title: 'Understand property and input types', paragraphs: [
			'Fields own their types. Strings and timestamps commonly read as `string | null` and `Date | null`; `required: true` checks validity at runtime, so narrow missing values before using them. Constructor and `create()` inputs are partial because a record can be filled before saving.',
			'Use `field.json<Preferences>()` to describe structured JSON values. This provides a TypeScript shape, not nested runtime validation. Many built-in field input types are `unknown` so they can normalize external values; inferred construction is not a substitute for validation.',
			'Use `ActiveRecord.InferInput<typeof Model>`, `ActiveRecord.InferValue<typeof Model>`, `ActiveRecord.InferDbRow<typeof Model>` and `ActiveRecord.InferDisplay<typeof Model>` when another API needs one of the field-owned shapes. Unknown object-literal keys are rejected by typed constructors and `create()`; request filling still follows its runtime fillable/guarded policy.',
		] },
		{ id: 'model-inheritance', title: 'Extend models and migrate existing definitions', paragraphs: [
			'Use `class Admin extends User { ... }` to add behaviour without changing fields. Use `class Staff extends User.define({ fields: field => ({ team: field.string() }) }) { ... }` to add fields. Inherited fields are included automatically; you do not spread `super.fields(field)` inside a `define()` factory.',
			'A matching field name replaces its entire inherited definition. Repeat any constraints or column settings you need to retain. Overrides must preserve both application and input value types; a field cannot replace an existing non-field instance member. Start a new root model when you need a different field value type.',
			'To convert an existing model, move static schema settings into the definition, move the static `fields()` body into its `fields` factory and remove duplicate `declare` properties. Keep application methods in the named class. Preserve fields and options, then type-check consumers and verify the committed schema still matches.',
			'Existing static `fields()` models remain supported. Their overrides still need `...super.fields(field)` when they include parent fields manually. A dynamically typed legacy field map cannot supply property names that TypeScript does not know.',
		] },
		{ id: 'define-fields', title: 'Define the fields', paragraphs: [
			'Pass the table name, request policy and `fields` factory to `ActiveRecord.define()`. `field.ulid()` creates a primary key in memory, before the first save. Required strings are trimmed and validated. Timestamp fields keep Date values in the backend and convert them for JSON.',
			'The named class extends the returned constructor. Its properties come from the fields, so `KnowledgeNote` needs no duplicate `declare` properties. Keep domain methods in the class body and let TypeScript infer the factory’s concrete return type.',
			'Only title and body are request-fillable. Ownership comes from trusted application code. A fillable list prevents mass assignment; it does not authenticate the caller or prove workspace membership.',
		], codeSampleId: 'note-model' },
		{ id: 'create-and-save', title: 'Create and save a note', paragraphs: [
			'Construct a record, fill the permitted request fields, assign trusted ownership, then call `save()`. A new record is inserted. A loaded record is updated when you save it again.',
			'`KnowledgeNote.create()` also creates an unsaved record. Unlike Laravel’s `create()`, it does not insert a row. Always call `save()` when you want persistence.',
			'The functions below assume the host has already authorized workspaceId. Do not pass a workspace from the request body as that trusted argument. Unknown and non-fillable payload keys are ignored; use request validation when your API must reject them.',
		], codeSampleId: 'note-operations' },
		{ id: 'read-records', title: 'Read the records you need', paragraphs: [
			'`where()` builds a query; `all()` executes it and returns model instances. `first()` returns one record or null. `firstOrFail()` throws RecordNotFoundError. `findByPk(id)` is a useful unscoped lookup, but it is not a tenant access check.',
			'For a workspace-owned resource, include both workspace and record identity when reading, editing or deleting. The example uses the same scoped lookup for updates and deletes, so another workspace’s ID is treated as not found.',
			'Bound list queries. The example returns at most twenty records, ordered by createdAt and then id. Use `count()` for a database count. `select()` takes logical field names; treat partially selected records as read-only views, not complete records to edit.',
		], links: [{ label: 'Filters, selection, ordering and query results', articleId: 'active-record-api', sectionId: 'query-methods' }] },
		{ id: 'validation', title: 'Handle validation failures', paragraphs: [
			'`save()` validates before writing. A blank or overlong title throws RecordValidationError; error.errors contains the field errors. `validate()` lets you check earlier and returns a boolean. Read `getErrors()` or `getFieldErrors(name)` afterwards.',
			'An HTTP adapter can map validation failure to 422 and a missing scoped record to 404. Return only the field, message and code your UI needs. Error objects can contain submitted values, so don’t serialize the entire error into logs or API responses.',
			'Field conversion is intentionally permissive: for example, a string field can coerce a number. Validate the raw request first when the endpoint needs strict input types. Field validation remains the final check before persistence.',
		], links: [{ label: 'Record validation and error inspection methods', articleId: 'active-record-api', sectionId: 'record-methods' }, { label: 'Request validation service', articleId: 'validation' }] },
		{ id: 'update-and-delete', title: 'Update or delete a note', paragraphs: [
			'Load the scoped record, apply the supplied editable fields, then save it. Omitted fields keep their existing values. `isDirty()` tells you whether values have changed; it is not an optimistic-locking or revision check.',
			'`delete()` permanently removes this example’s row. If you need undo, use a model with softDeletes enabled and a deletedAt timestamp field. `withTrashed()`, `onlyTrashed()`, `restore()` and `forceDelete()` are available in the reference; this recipe does not exercise soft deletion.',
			'Concurrent edits need an application policy. Saving a record does not automatically detect that someone else changed the same field.',
		], links: [{ label: 'Deletion, soft-delete and dirty-state APIs', articleId: 'active-record-api', sectionId: 'record-methods' }] },
		{ id: 'json', title: 'Return JSON without rebuilding the record', paragraphs: [
			'Use `note.toJSON()` for field-owned transport values. A timestamp becomes a string; hidden fields stay out of the result. `toAppData()` keeps backend values such as Date objects, while also respecting hidden fields.',
			'Conversion is not authorization. Return the whole record only if the caller may see every visible field. Otherwise choose a permitted response shape at the endpoint.',
		] },
		{ id: 'transactions', title: 'Save several records together', paragraphs: [
			'For a read followed by a protected update, use Model.where(...).forUpdate().first() inside the transaction. forUpdate() delegates to Knex while returning typed model instances. It does not start a transaction. Row locks are released automatically on commit or rollback, including when the callback throws. Keep transactions short and external service calls outside them.',
			'Open a transaction through `app().db.knex`, then run the work inside `ActiveRecord.withDb()`. The feature functions keep using the normal model API. If any save fails, the transaction rolls back.',
			'Create or load participating records inside that scope. Records already bound to a connection are not automatically moved into the transaction. Keep provider calls and other slow external work outside the database transaction.',
		], codeSampleId: 'note-transaction' },
		{ id: 'coverage', title: 'What this guide covers', paragraphs: [
			'The tested path covers model fields, ULIDs, safe request filling, inserts, scoped queries, validation failures, updates, JSON, hard deletion and rollback. It also explains App setup and the boundary between this lab and application migrations.',
			'Advanced reference: query operators, dirty state, soft deletion, request maps, field metadata, forms, custom fields and lower-level connection/hydration controls. These are reference coverage, not a claim that every advanced workflow has a walkthrough.',
			'Still to write: relationship loading and projections, a migration-first HTTP API, cursor pagination, and conflict-aware editing. Cross-service recipes are tracked under Solve a problem.',
		], links: [{ label: 'Full ActiveRecord and query API', articleId: 'active-record-api' }, { label: 'Solve a problem: recipes and planned walkthroughs', articleId: 'solve-a-problem' }] },
	],
	codeSamples: [
		{ id: 'hidden-queries-pseudocode', title: 'Illustrative pseudocode, not the db3.ai API', language: 'typescript', code: '// Illustrative pseudocode, not the db3.ai API.\nfor (const user of users) {\n\tfor (const project of await user.getProjects()) {\n\t\tawait project.runReport();\n\t}\n}' },
		{ id: 'inferred-user', title: 'DefinedUser.ts', language: 'typescript', code: serviceExampleSources.definedUser },
		{ id: 'note-model', title: 'KnowledgeNote.ts', language: 'typescript', code: serviceExampleSources.knowledgeNote },
		{ id: 'note-operations', title: 'workspaceNotes.ts', language: 'typescript', code: serviceExampleSources.workspaceNotes },
		{ id: 'note-transaction', title: 'createNotesTogether.ts', language: 'typescript', code: serviceExampleSources.createNotesTogether },
	],
	relatedIds: ['guide-workspace-notes', 'active-record-api', 'solve-a-problem'],
	keywords: ['active record activefield field lifecycle model database fields create save validation workspace tenant query transaction'],
};
