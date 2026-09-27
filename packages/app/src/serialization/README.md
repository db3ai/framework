# Serialization

## Runnable scalar-state example

Copy `src/serialization/examples/` from the installed package into `examples/`
and run `npx tsx examples/runExportSerialization.ts`. The registered request
crosses a real JSON boundary, initializes private state, rejects a missing
worker registration and invalid state, then recovers. It requires no SQL.
The website includes `tests/examples/runExportSerialization.test.ts` as an
exact consumer-copyable test. Model-reference behavior remains covered by the
separate service SQL tests, not this scalar-identity example.

The framework serializer reconstructs one registered root class from durable
constructor state. It produces a versioned JSON-safe envelope and restores that
object inside a bootstrapped application process.

The service is available through `app().serializer`. Its application-scoped
allowlist is available through `app().serializer.registry`.

## Application configuration

Register root classes and ActiveRecord models with explicit stable names:

```ts
import type { SerializerOptions } from '@db3.ai/app/serialization';

const serializer: SerializerOptions = {
	classes: {
		'report.request': ReportRequest,
	},
	models: {
		'app.user': User,
		'app.website': Website,
	},
};

new App({
	serializer,
});
```

The same entries can be registered during application boot:

```ts
app().serializer.registry.registerClass('report.request', ReportRequest);
app().serializer.registry.registerModel('app.website', Website);
```

Registration is idempotent for the same name and constructor. Reusing a name
or constructor for a different entry throws. The names are durable wire
contracts, so stored payloads must be migrated or discarded before a name
changes.

Every producer and worker process must install the same registrations during
boot. A process-local registration performed only while dispatching cannot make
the constructor available to another queue worker.

## Root constructor contract

A registered root class implements `Serializable<TState>`. Its `toJSON()`
method returns the complete state accepted by its one-argument constructor:

```ts
import type { Serializable } from '@db3.ai/app/serialization';

interface ReportRequestState {
	website: Website;
	options: {
		includeDrafts: boolean;
	};
}

class ReportRequest implements Serializable<ReportRequestState> {
	/**
	 * Creates a report request from its complete runtime state.
	 *
	 * @param state - State used for both direct and restored construction.
	 */
	constructor(readonly state: ReportRequestState) {}

	/**
	 * Returns the state needed to call this constructor again.
	 *
	 * @returns Complete report request constructor state.
	 */
	toJSON(): ReportRequestState {
		return this.state;
	}
}
```

Serialization resolves the instance's exact registered prototype and invokes
that prototype's `toJSON()` exactly once. It does not inspect arbitrary root
properties or invoke `toJSON()` on nested values.

Deserialization validates the entire envelope, restores nested ActiveRecord
references, and then calls `new RegisteredClass(state)`. Normal constructor
validation therefore runs in both direct and restored execution, and private
fields are initialized normally.

## Constructor state

Constructor state supports ordinary JSON values:

- `null`, strings, booleans, and finite numbers;
- dense arrays; and
- plain objects through their normal enumerable string properties.

Registered ActiveRecord instances are the only non-JSON values supported
inside that state. Nested application classes, `undefined`, `bigint`, `Date`,
functions, maps, sets, custom object prototypes, sparse arrays, invalid
numbers, and cycles throw a path-aware `SerializationError`. As with ordinary
JSON, symbol and non-enumerable properties are outside the serialized shape,
and enumerable getters are read. Repeated non-cyclic plain objects are copied
and do not preserve object identity.

The `$platform` object key is reserved for framework reference markers. Convert
optional or specialist runtime values to an intentional JSON representation in
the root class's `toJSON()` result.

## ActiveRecord references

A registered, clean, persisted ActiveRecord is stored as a model key and
logical primary key rather than as an attribute snapshot:

```json
{
	"$platform": "active-record",
	"model": "app.website",
	"id": "01J..."
}
```

Serialization rejects a record that is unregistered, unsaved, dirty, missing a
supported string or safe-integer primary key, or already soft deleted. Dirty
checks include in-place changes to structured field values.

Deserialization resolves the registered model and calls `findOrFail()` through
the active application database. The restored object therefore contains the
current stored row, not a stale attribute snapshot. Repeated references to the
same model and primary key share one lookup and restored instance. Errors
distinguish a missing row from another database restoration failure.

If a missing record should be a valid no-op for a workflow, store its scalar id
as ordinary constructor state and perform that optional lookup in the workflow.

## Envelope and validation

The wire shape is explicit and versioned:

```json
{
	"format": "platform.serialized-object",
	"version": 1,
	"name": "report.request",
	"state": {}
}
```

The complete envelope is validated before any database query or root
constructor call.

Use a real JSON boundary when verifying durable values:

```ts
const payload = app().serializer.serialize(value);
const durablePayload = JSON.parse(JSON.stringify(payload));
const restored = await app().serializer.deserialize(durablePayload);
```
