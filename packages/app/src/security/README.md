# Security

The security service centralizes reversible application encryption. It reads
its key and cipher from the active app config, then owns the authenticated
cipher, versioned payload format, and JSON serialization used by framework
fields and application services.

Password hashing is intentionally separate. Passwords are verified through a
one-way hash and have no reusable encryption key; values such as webhook secrets
and WordPress application passwords must be decrypted later and therefore use
`app().security`.

## Run a disposable secret round trip

Complete [Installation](https://db3.ai/framework/docs/installation), then run in your independent app:

```sh
mkdir -p examples
cp -R node_modules/@db3.ai/app/src/security/examples/. examples/
npx tsx examples/runSecretRoundTrip.ts
```

Expect `roundTrip`, `randomized`, `contextRejected`, `tamperingRejected` and `nonJsonRejected` all true. The example uses real encryption and a disposable App. It prints no key, plaintext or ciphertext, makes no database connection and does not read or write `.env`.

The key is generated for the lab only. A persistent application must generate a key once during provisioning and retain it; copying the per-run lab key pattern into production would make stored secrets unreadable after restart.

Copy the exact test from the [Security guide](https://db3.ai/framework/docs/security#testing) into `tests/security/runSecretRoundTrip.test.ts` and run:

```sh
npx vitest run tests/security/runSecretRoundTrip.test.ts
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck examples/*.ts
```

The tests check tampering, wrong-owner context and a different key, then prove the original service can still decrypt its value. Wrong-key failures must not silently overwrite ciphertext with an empty secret. These tests do not replace authorization or database backup/restore tests.

## Configuration

Applications should define a `security` config section:

```ts
import { defineConfig, env } from '@db3.ai/app/config';
import { ensureAppKey, type SecurityOptions } from '@db3.ai/app/security';

export default defineConfig({
	key: env.string('APP_KEY') || ensureAppKey(),
	cipher: 'aes-256-gcm',
} satisfies SecurityOptions);
```

`ensureAppKey()` is a convention-based convenience for application config. It
always uses `APP_KEY` and `.env`: an existing non-empty value is preserved, a
missing value is generated and written to `.env`, and a persistence failure
throws `SecurityError` so startup fails. The security service itself does not
read environment variables or write files; `app().config` remains the boundary
between environment configuration and framework services.

The same key must be available to every API and worker process that reads or
writes encrypted data. Back it up separately from the database: losing or
changing the key makes existing ciphertext unreadable. Key rotation is not yet
implemented, so replace the key only as part of a deliberate data re-encryption
operation.

Writable dotenv files are convenient for local and single-host environments.
Production containers commonly use a read-only application filesystem and
inject secrets through their deployment platform. Providing `APP_KEY`
externally bypasses `ensureAppKey()` and no file write is attempted. Replicated
processes must receive one shared key rather than generating separate keys into
ephemeral files.

Keys can also be generated explicitly when provisioning a deployment:

```sh
printf 'base64:%s\n' "$(openssl rand -base64 32)"
```

## Encryption

New payloads use AES-256-GCM with a random 96-bit initialization vector and a
128-bit authentication tag. The stored envelope includes a format version and
cipher name so future readers can distinguish formats. Encryption authenticates
both the ciphertext and optional caller-supplied context.

```ts
const payload = app().security.encryptJson({
	token: 'provider-secret',
}, {
	additionalAuthenticatedData: 'websites:blog_integration',
});

const value = app().security.decryptJson<{ token: string }>(payload, {
	additionalAuthenticatedData: 'websites:blog_integration',
});
```

Never log plaintext, ciphertext, keys, or decrypted provider errors.

Additional authenticated context is not stored in the envelope; reconstruct it identically when decrypting. It authenticates use but does not authorize the caller. `decrypt()` returns a Buffer; `decryptJson<T>()` parses JSON but does not validate the generic type at runtime. The key is pinned for the service lifetime, not reread on each operation.

## Encrypted model fields

Use `field.encryptedJson<T>()` for JSON-compatible secrets stored on an
ActiveRecord model:

```ts
blogIntegration: field.encryptedJson<BlogIntegration>({
	column: 'blog_integration',
	selectedByDefault: false,
})
```

The field stores versioned ciphertext in a long text column. It is always hidden
from `toJSON()`, cannot be populated through request helpers when request
guarded, and cannot be used in equality queries because encryption is
randomized. It also authenticates the model table and database column name so a
payload copied to a different encrypted field will not decrypt.

That automatic field context is table/column identity, not row-level ownership. Keep authorization and any row/tenant binding policy explicit.

For fields with `selectedByDefault: false`, integration-specific server code
must opt in explicitly:

```ts
const website = await Website
	.query()
	.withField('blogIntegration')
	.wherePk(websiteId)
	.firstOrFail();
```

See [all current Security contracts](https://db3.ai/framework/docs/security-api) for key, cipher, payload and error options. Automatic key rotation, KMS integration and searchable encryption are not implemented. Keep a re-encryption/backup plan separate from this local happy path.
