# Validation

`@db3.ai/app/validation` provides a small validation layer for
plain request data.

## Run a note-input boundary

Complete [Installation](https://db3.ai/framework/docs/installation), using the matching tarballs while npm publication is pending. From your independent app:

```sh
npm install --save-dev tsx typescript @types/node vitest
mkdir -p examples
cp -R node_modules/@db3.ai/app/src/validation/examples/. examples/
npx tsx examples/runNoteValidation.ts
```

Expect two errors for the first request (blank title and excessive priority). The repaired request returns exactly `{ title: "First note", priority: 2 }`. The example selects writable fields explicitly and never returns submitted secrets, extra properties or an attacker-supplied owner. It does not persist anything or require a database.

[`validateNoteInput.ts`](./examples/validateNoteInput.ts) is the application-owned boundary; [`runNoteValidation.ts`](./examples/runNoteValidation.ts) exercises failure and recovery. The [website walkthrough](https://db3.ai/framework/docs/validation#testing) renders the exact test. Save it as `tests/validation/runNoteValidation.test.ts` and run:

```sh
npx vitest run tests/validation/runNoteValidation.test.ts
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck examples/*.ts
```

Request validation is not authorization. Before writing data, use authenticated ownership and an explicit input policy. When writing an ActiveRecord model, let its fields own conversion rather than copying DB conversion into the route.

```ts
import { validate } from '@db3.ai/app/validation';

const result = validate(request.body, {
	email: ['required', 'email'],
	name: ['required', 'string', { rule: 'maxLength', value: 80 }],
});

if (!result.valid) {
	return reply.status(422).send({
		errors: result.errors.map(({ field, rule, message }) => ({ field, rule, message })),
	});
}
```

## API

### `validate(data, rules)`

Validates a plain object and returns a result object.

```ts
const result = validate(data, rules);

if (result.valid) {
	// result.data is the original object typed as a record.
}
```

Return shape:

```ts
interface ValidationResult<TData extends Record<string, unknown>> {
	valid: boolean;
	data: TData;
	errors: ValidationFailure[];
}
```

`validate()` does not coerce or transform `data`. For example, the `integer`
rule accepts `"42"` as valid input, but `result.data.age` remains the string
`"42"`. Model fields or request DTO code should still own conversion into app
types.

If `data` is not a plain object, validation runs against an empty object.

### `assertValid(data, rules)`

Validates data and returns the original record when valid. It throws
`ValidationException` when validation fails.

```ts
import {
	assertValid,
	ValidationException,
} from '@db3.ai/app/validation';

try {
	const data = assertValid(request.body, {
		email: ['required', 'email'],
	});
} catch (error) {
	if (error instanceof ValidationException) {
		return reply.status(422).send({
			errors: error.errors.map(({ field, rule, message }) => ({ field, rule, message })),
		});
	}

	throw error;
}
```

## Rules

Rules are keyed by field name. Field names currently match top-level keys on the
input object.

```ts
const rules = {
	email: ['required', 'email'],
	age: ['nullable', 'integer', 'min:18'],
	role: [{ rule: 'in', values: ['admin', 'editor'] }],
};
```

Rules can be written in three forms:

```ts
type ValidationRule =
	| 'required'
	| 'email'
	| 'maxLength:80'
	| {
		rule: 'maxLength';
		value: 80;
		message?: string;
	};
```

Use the object form when a rule needs structured values, a regular expression,
or a custom message.

## Presence Rules

### `required`

The field must be present and non-empty.

Whitespace-only strings are not empty to this rule. Add a non-whitespace pattern such as `/\S/` when required, then explicitly trim or let your field normalize the value.

These values fail `required`:

- missing key
- `undefined`
- `null`
- empty string
- empty array

### `nullable`

Allows the field to be missing, `undefined`, `null`, or an empty string. When a
nullable value is empty, the rest of that field's rules are skipped.

```ts
validate(data, {
	website: ['nullable', 'url'],
});
```

Without `nullable`, optional missing values are still skipped by non-presence
rules. Use `required` when the field must be supplied.

## Type And Format Rules

### `string`

Passes when the value is a string.

### `number`

Passes for finite numbers and number-like strings such as `"12.5"`.

### `integer`

Passes for integers and integer-like strings such as `"42"`.

### `boolean`

Passes for booleans, `0`, `1`, and common form strings:

- `true`
- `false`
- `1`
- `0`
- `yes`
- `no`
- `on`
- `off`

### `email`

Passes for basic email-shaped strings.

### `url`

Passes for HTTP/HTTPS-shaped URLs. This is not an SSRF, public-network or authorization check. Values without a protocol are checked as if
they had `https://` prepended.

```ts
validate({
	website: 'example.com',
}, {
	website: ['url'],
});
```

The URL rule requires a hostname containing a dot, so `localhost` fails.

### `array`

Passes for arrays.

### `object`

Passes for objects other than arrays and `Date` instances. This does not enforce a plain-object prototype.

### `ulid`

Passes for canonical ULID-shaped strings.

### `uuid`

Passes for versioned UUID strings.

## Size And Comparison Rules

### `min`

For numeric values, compares the number. For non-numeric strings and arrays,
compares length.

```ts
validate(data, {
	age: ['integer', 'min:18'],
	tags: ['array', { rule: 'min', value: 1 }],
});
```

### `max`

For numeric values, compares the number. For non-numeric strings and arrays,
compares length.

```ts
validate(data, {
	score: ['number', 'max:100'],
	tags: ['array', { rule: 'max', value: 7 }],
});
```

### `minLength`

Compares string or array length.

### `maxLength`

Compares string or array length.

## Choice And Pattern Rules

### `in`

Passes when the value matches one of the allowed values.

```ts
validate(data, {
	status: [{ rule: 'in', values: ['draft', 'published'] }],
});
```

String shorthand is also available:

```ts
validate(data, {
	status: ['in:draft,published'],
});
```

### `regex`

Passes when a string matches the pattern.

Prefer expressions without `g` or `y`: these flags make `RegExp.test()` stateful when the same object is reused.

```ts
validate(data, {
	slug: [{ rule: 'regex', pattern: /^[a-z0-9-]+$/ }],
});
```

String shorthand accepts either a plain pattern or slash-delimited pattern:

```ts
validate(data, {
	slug: ['regex:/^[a-z0-9-]+$/'],
});
```

## Error Shape

Validation failures are returned as structured errors:

```ts
interface ValidationFailure {
	field: string;
	rule: ValidationRuleName;
	message: string;
	value?: unknown;
	details?: Record<string, unknown>;
}
```

Example:

```json
[
	{
		"field": "email",
		"rule": "email",
		"message": "email must be a valid email address",
		"value": "not-an-email"
	}
]
```

Rule object messages override the default message:

```ts
validate(data, {
	email: [{
		rule: 'email',
		message: 'Enter a valid work email address.',
	}],
});
```

## ActiveRecord Integration

Models can generate request-level validation rules from their fields:

```ts
const rules = Website.validationRules();
const result = validate(request.body, rules);
```

By default, generated model rules exclude:

- primary-key fields
- generated fields
- hidden fields
- fields blocked by `requestGuarded`
- fields not listed in `requestFillable`, when `requestFillable` is defined

You can override this per call:

```ts
const rules = Website.validationRules({
	includePrimary: true,
	includeGenerated: true,
	includeHidden: true,
	fillable: ['url', 'businessName'],
	guarded: ['user'],
});
```

Use this pattern at request boundaries:

```ts
const rules = Website.validationRules({
	fillable: ['url', 'businessName', 'targetAudiencePhrases'],
});
const result = validate(request.body, rules);

if (!result.valid) {
	return reply.status(422).send({
		errors: result.errors.map(({ field, rule, message }) => ({ field, rule, message })),
	});
}

const website = new Website();

website.setFromRequestWithMap(request.body, Website.onboardingRequestMap);
website.assign({ user: currentUser });
await website.save();
```

Field-level validation still runs during `record.validate()` and `record.save()`.
Request-level validation is the earlier, plain-data check before a model is
hydrated.

## Coverage and limits

The runnable note lab tests rejection/recovery, safe error output, explicit field selection, form-string conversion, optional/nullable values, length versus numeric size, custom messages and throwing validation. The [full API reference](https://db3.ai/framework/docs/validation-api) contains all current exported rules and helper signatures.

Errors contain the original `value` and optional rule `details`; do not return or log them blindly. The validator does not strip unknown keys, normalize values, traverse nested paths, validate array wildcards, run asynchronous uniqueness checks or enforce ownership. `in` also accepts values with equal string representations. Use explicit nested validation or field-owned structures and keep authorization in the application.

## Field-Generated Rules

Fields publish reusable validation rules with `getValidationRules()`.

```ts
class StringField extends FieldType<string | null> {
	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		return [
			...super.getValidationRules(ctx),
			'string',
			{
				rule: 'maxLength',
				value: this.config.maxLength,
			},
		];
	}
}
```

Custom fields should include rules that describe their public input contract.
Keep domain or cross-field rules on the model or request object.

## Boundaries

Use validation for these jobs:

- validating raw request data before filling a model
- validating payloads for jobs, services, imports, or integrations
- reusing model field rules without constructing a record
- returning structured 422-style errors to API clients

Use fields for these jobs:

- normalising data into app memory
- converting database values
- converting display/API values
- record persistence validation

Validation answers "is this payload acceptable?". Fields answer "how does this
value move through the app?".
