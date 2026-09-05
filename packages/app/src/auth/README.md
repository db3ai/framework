# @db3.ai/app/auth

`@db3.ai/app/auth` provides account identities, pluggable login providers,
bearer tokens, password reset tokens, password hashing, and request-scoped
authenticated-user state.

The package is deliberately HTTP-framework agnostic. An app owns its routes,
request validation, cookies or bearer-token transport, rate limiting, and UI.
The auth service owns provider verification, account/provider persistence, and
token issuance.

## Mental Model

An account and a login method are different things:

- `UserIdentity` is the account. It stores the stable application identity:
  name, email, email verification time, account avatar, and account timestamps.
- `AuthProvider` is one way to prove control of that account. A user may have a
  password provider, Google provider, and future providers at the same time.
- `AuthProviderDriver` verifies provider-specific proof and returns one
  normalized `AuthProviderProfile`.
- `Auth` connects verified profiles to accounts, manages provider links, and
  issues sessions.
- `AuthToken` stores hashed bearer tokens. The plaintext token is returned only
  when it is created.
- `PasswordResetToken` stores hashed, expiring, single-use reset tokens.

The important relationship is:

```text
users (account)
  1
  +-- many auth_providers (password, google, future providers)
  +-- many auth_tokens (bearer sessions)
  +-- many password_reset_tokens
```

Password authentication is a provider even though it is first-party rather
than OAuth. This keeps application routes and account settings consistent:
every login starts with a provider, and providers can be listed, linked, or
removed through the same auth service.

## App Setup

Apps normally extend `UserIdentity` and pass the model to the framework app:

```ts
import { UserIdentity } from '@db3.ai/app/auth';
import type { FieldBuilder } from '@db3.ai/app/db';

export class User extends UserIdentity {
	static override table = 'users';

	static override fields(field: FieldBuilder) {
		return {
			...UserIdentity.fields(field),
			selectedWebsiteId: field.string({
				column: 'selected_website_id',
			}),
		};
	}
}
```

```ts
import { App } from '@db3.ai/app/server';
import auth from './config/auth.js';
import { User } from './models/User.js';

const app = new App({
	config: {
		auth,
	},
	auth: {
		identityModel: User,
	},
});
```

The framework `App` constructs one `Auth` service with the application
database, config repository, identity model, and request context. Normal app
code accesses it through `app.auth`.

`UserIdentity.avatarUrl` is the account-owned avatar. An external provider can
supply its initial value. Later provider logins only backfill a missing account
avatar, so a user-selected avatar is not overwritten. The provider's latest
reported image remains available on its `AuthProvider.avatarUrl` row.

## Provider Configuration

Apps configure enabled providers under `auth.providers`. A provider entry can
be `true`, `false`, an options object, or a concrete custom driver instance.

```ts
import { GOOGLE_AUTH_PROVIDER, PASSWORD_AUTH_PROVIDER, type AuthProviderRegistry } from '@db3.ai/app/auth';
import { defineConfig, env } from '@db3.ai/app/config';
import type { User } from '../models/User.js';

const googleClientIds = [
	...env.array('GOOGLE_AUTH_CLIENT_IDS', []),
	env.string('GOOGLE_AUTH_CLIENT_ID'),
].filter((value): value is string => Boolean(value));

export default defineConfig({
	providers: {
		[PASSWORD_AUTH_PROVIDER]: {
			driver: PASSWORD_AUTH_PROVIDER,
		},
		[GOOGLE_AUTH_PROVIDER]: {
			driver: GOOGLE_AUTH_PROVIDER,
			enabled: googleClientIds.length > 0,
			clientIds: googleClientIds,
			hostedDomain: env.string('GOOGLE_AUTH_HOSTED_DOMAIN'),
		},
	},
} satisfies {
	providers: AuthProviderRegistry<User>;
});
```

The auth package reads config values; it does not impose environment variable
names. The names above are the convention used by Scout and are a useful
default for other apps.

## Password Provider

Enable the built-in password driver with:

```ts
[PASSWORD_AUTH_PROVIDER]: {
	driver: PASSWORD_AUTH_PROVIDER,
},
```

Register a password-backed account and issue its first bearer token:

```ts
const issued = await app.auth.registerWithPassword({
	name: 'Ada Lovelace',
	email: 'ada@example.com',
	password: submittedPassword,
});
```

Authenticate an existing password provider:

```ts
const issued = await app.auth.issueTokenForProvider(PASSWORD_AUTH_PROVIDER, {
	email: submittedEmail,
	password: submittedPassword,
});

if (!issued) {
	// Return the app's generic invalid-credentials response.
}
```

Password hashes live on `auth_providers.password`, not on the user row. The
field hashes plaintext during database serialization and never exposes the
stored hash through JSON.

Password-reset routes should find the user without revealing whether the email
exists, call `createPasswordResetToken(user)`, send the plaintext token once,
and later redeem it with `resetPassword(...)`.

## Google Provider

The built-in Google driver accepts a Google Identity Services ID token. It
verifies the signature against Google's JWK set and validates the issuer,
audience, expiry, subject, and optional hosted-domain restriction. It then
normalizes Google claims such as email, name, picture, locale, and Google `sub`.

### Google Cloud setup

1. Create or select a project in Google Cloud Console.
2. Configure the OAuth consent screen and branding.
3. Create an OAuth client with application type **Web application**.
4. Add every browser origin under **Authorized JavaScript origins**, including
   scheme and port for development, such as `http://localhost:5173`.
5. Put the web client id in `GOOGLE_AUTH_CLIENT_ID`. Use
   `GOOGLE_AUTH_CLIENT_IDS` as a comma-separated list while accepting multiple
   deployments or rotating client ids.
6. Optionally set `GOOGLE_AUTH_HOSTED_DOMAIN` to restrict authentication to one
   Google Workspace domain.
7. Load Google Identity Services in the browser, render its official button,
   and send the callback's `credential` ID token to the app's backend.

Useful Google guides:

- Setup and create a web client:
  <https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid>
- Render the official sign-in/sign-up button:
  <https://developers.google.com/identity/gsi/web/guides/display-button>
- Verify Google ID tokens on a backend:
  <https://developers.google.com/identity/gsi/web/guides/verify-google-id-token>

No Google client secret is required to verify a Google Sign-In ID token. OAuth
access and refresh tokens for Search Console, Analytics, Calendar, or other
Google APIs are a separate integration concern and should not be stored on the
authentication provider row.

Authenticate or create the account from a Google credential:

```ts
const issued = await app.auth.issueTokenForProvider(GOOGLE_AUTH_PROVIDER, {
	credential: request.body.credential,
});
```

The first verified use creates a user and Google provider row. Later uses find
the account through Google's stable `sub` claim. If an account already exists
with the same email but Google is not linked, auth throws
`AuthIdentityExistsError`; the app should ask the authenticated user to link
Google explicitly rather than automatically merging accounts by email.

### AI assistant prompt

An app developer can give an AI coding assistant this focused instruction:

```text
Configure Google Sign-In using @db3.ai/app/auth and the app config repository.
Use Google Identity Services in the browser and send its credential ID token to
the backend. Configure the Google provider with GOOGLE_AUTH_CLIENT_ID or
GOOGLE_AUTH_CLIENT_IDS, verify through app.auth.issueTokenForProvider('google',
...), and return the app's normal session response. Do not store Google access
or refresh tokens in auth_providers, do not auto-link accounts by matching email,
and add explicit rate limiting to the public auth route.
```

## Provider Account Management

List linked login methods:

```ts
const providers = await app.auth.providersFor(user);
const summaries = providers.map(provider => provider.toSummary());
```

`toSummary()` is the settings-safe API projection. It excludes password hashes,
provider-owned identifiers, and raw provider profile metadata.

Link a verified provider to an already-authenticated account:

```ts
const provider = await app.auth.linkProvider(user, GOOGLE_AUTH_PROVIDER, {
	credential: googleCredential,
});
```

Remove a provider by row id or provider name:

```ts
await app.auth.unlinkProvider(user, GOOGLE_AUTH_PROVIDER);
```

`unlinkProvider` throws `AuthLastProviderError` when removal would leave the
account with no login method. Provider linking and removal routes must require a
recently authenticated user; the package does not make that HTTP policy choice
for the app.

## Custom Providers

A custom provider implements `AuthProviderDriver` and translates its proof into
an `AuthProviderProfile`. Drivers verify proof only; they do not create users or
issue sessions.

```ts
import type { AuthProviderDriver, AuthProviderProfile } from '@db3.ai/app/auth';

export class ExampleAuthProvider implements AuthProviderDriver<{
	token: string;
}> {
	readonly provider = 'example';

	async verify(input: { token: string }): Promise<AuthProviderProfile | null> {
		const externalUser = await verifyExampleToken(input.token);

		if (!externalUser) return null;

		return {
			provider: this.provider,
			providerUserId: externalUser.id,
			email: externalUser.email,
			emailVerifiedAt: externalUser.emailVerified ? new Date() : null,
			name: externalUser.name,
			avatarUrl: externalUser.avatarUrl,
		};
	}
}
```

Register the concrete driver through `AuthOptions.providers` or the app's auth
provider config. Magic-link authentication can use the same normalized profile
contract, but token generation, email delivery, expiry, and single-use
redemption must be implemented as a dedicated first-party driver/service.

## Bearer Sessions

`issueTokenForProvider(...)` returns an `IssuedAuthToken` containing the
plaintext bearer token once. Persist only the hashed `AuthToken` record.

At an HTTP boundary, read the bearer value and authenticate it:

```ts
const user = await app.auth.authenticateToken(bearerToken);

if (!user) {
	// Return 401.
}
```

With the framework request context enabled, repeated authentication of the same
token during one request is memoized and `app.auth.user` is request-scoped.
Use `app.auth.requireUser()` only after the route has established authentication.

Browser apps can attach session metadata through `AuthTokenOptions` when issuing
a token:

```ts
const issued = await app.auth.issueTokenForProvider('password', credentials, {
	name: 'Chrome on macOS',
	ipAddress: request.ip,
	userAgent: request.headers['user-agent'],
	browser: 'Chrome',
	operatingSystem: 'macOS',
	device: 'Desktop',
});
```

The framework stores the raw user agent for server-side diagnostics but hides it,
along with the token hash, from model JSON. `AuthToken.toSessionData()` returns a
safe account-management projection.

List and revoke active sessions through the authenticated account:

```ts
const sessions = await app.auth.tokensFor(user);
await app.auth.revokeToken(user, sessionId);
await app.auth.revokeCurrentToken();
```

Revocation sets `revokedAt`; the next bearer-token authentication rejects the
session before loading its user. `tokensFor(...)` excludes revoked and expired
sessions. The current authenticated token is available as `app.auth.token`
inside the request context so an app can mark the current browser session.

## Security Responsibilities

The auth package validates credentials and tokens, but the application still
owns HTTP security controls:

- Rate-limit public sign-in, sign-up, provider, forgot-password, and reset routes.
- Use generic invalid-credential and forgot-password responses to reduce account
  enumeration.
- Accept bearer tokens only over HTTPS in production.
- Configure Fastify `trustProxy` only for known reverse proxies before using
  request IPs as rate-limit keys.
- Use a shared rate-limit store when API traffic is handled by multiple processes.
- Let users inspect and revoke active bearer sessions, and revoke the current
  token during sign-out rather than only deleting browser storage.
- Keep provider client secrets and integration refresh tokens out of JSON,
  browser config, and `auth_providers.profile`.
- Require an authenticated user before linking or unlinking providers.
- Do not automatically link an external provider to an existing account solely
  because an email claim matches.

Applications can provide explicit route middleware with tools such as
`@fastify/rate-limit`; keep the concrete limits and store configuration in the
consuming application's server configuration.

Revocable bearer sessions do not prevent JavaScript from reading a token stored
in `localStorage`. Browser apps with an XSS-sensitive threat model should use a
Secure, `HttpOnly`, `SameSite` cookie transport and add CSRF protection for
state-changing requests. That transport is app-owned and is not automatically
selected by this HTTP-framework-agnostic package.

## Verification

The [password auth lab](./examples/runPasswordAuth.ts) exercises real SQL
registration, correct/incorrect sign-in, bearer authentication, password reset,
sequential reset-token reuse rejection and revocation. Copy it from the installed
package into `examples` and run `npx tsx examples/runPasswordAuth.ts` with a
dedicated test account allowed to create/drop `db3_app_test_*` databases.
It creates a unique database and removes it in `finally`; no email is sent and
no token is logged. It is not a public HTTP auth endpoint.

The lab does not establish race-safety for concurrent registration or reset
redemption. Resetting a password does not automatically revoke existing bearer
sessions; the application must choose and enforce that policy. The website's
Auth page includes the exact test to copy into an independent application.

Run the auth package tests from the repository root:

```sh
npm run test:service --workspace packages/app -- auth
npm run check --workspace packages/app
```
