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
names. The names above are examples; choose names that fit your application.

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

Successful `resetPassword(...)` and `changePasswordProvider(...)` calls replace
the password, invalidate all outstanding password-reset links, and revoke every
bearer session in one database transaction. This includes the current device;
the app should clear its browser credentials and return to sign-in after a
successful password change. Account-row locks serialize concurrent password
replacements so two recovery links cannot both succeed. Invalid input or a
database failure rolls back the complete operation.

`setPasswordProvider(...)` is the low-level credential setup operation. Use the
reset/change methods for account recovery and authenticated password changes.

### Failed-password suspension

Register `PasswordLoginAttempt` alongside `AuthProvider`, `AuthToken` and
`PasswordResetToken` in the application's model registry and committed migrations.
The `auth_password_login_attempts` table keeps one unique normalized-identity
SHA-256 key, readable normalized `identity` (email), consecutive failure count and
nullable `suspendedAt`. It has no user foreign key and records attempts for unknown
emails exactly as for existing ones. `createdAt` records when the identity was
first seen; `updatedAt` records the latest password sign-in or recovery activity,
including refused attempts after suspension. Passwords are never recorded here.
The digest remains the exact unique key independently of SQL text collation;
it does not conceal the email. Legacy digest-only rows gain their readable
identity on the next attempt without clearing their failure count or suspension.

After 20 failures by default, password sign-in for that email requires recovery.
There is no timed unlock and a correct password cannot clear suspension. Before
suspension, successful verification resets consecutive failures. A completed,
identity-matched password reset clears the state in the same transaction as the
credential replacement and session revocation. Asking for a reset or submitting
an invalid/expired reset link does not clear it. Google sign-in remains available.

```ts
password: {
	driver: 'password',
	suspension: { maxFailedAttempts: 20 }, // or suspension: false
},
```

Known and unknown identities receive the same `PasswordSuspendedError` and public
message. Unknown identities also perform password-hash verification with the
configured hasher (default-cost scrypt by default) before recording failure.
No account ID, timestamp, automatic retry deadline or
account-existence flag belongs in the response. An HTTP adapter can map this error
to `429 too_many_attempts`, with no `Retry-After` because recovery is required.
The public message is "Too many sign-in attempts. Use password recovery to continue."

Only the error that first commits a suspension carries a `suspension` value:
`{ attemptId, suspensionId }`. Later blocked requests carry `null`. These opaque
identifiers exist equally for registered and unknown identities and are for
server-side work only; serialize the public code/message, not the whole error.
An application can enqueue one recovery-notice job after catching this transition.
The worker should find the attempt, confirm its `suspensionId` is still current,
resolve an exactly matching account and send that owner a secure link from
`Auth.createPasswordResetToken`. Never email unregistered submitted addresses.
Templates, queueing and delivery policy remain application-owned. A reset clears
the occurrence ID; a later suspension receives a new ID, so delayed jobs can be
discarded without confusing separate suspension periods.

Verification, failure counting and suspension share a per-identity SQL row lock.
Concurrent first attempts use a unique-key upsert, and each verifier sees committed
state before checking a password. Recovery takes the same lock. An attempt already
verified before a later suspension is ordered before it; a verifier waiting behind
the threshold-reaching failure cannot authenticate or clear the suspension.

Keep IP-based limits and explicit trusted-proxy configuration: suspension does not
prevent password spraying across many identities or intentional denial of password
sign-in for an email. Records are retained without automatic deletion so operators
can inspect targeted emails and recent activity. This is current suspension state,
not a per-attempt event history: successful verification resets the counter before
suspension, and verified recovery clears suspension. Operational logs may supplement
investigations but do not replace this transactional state. A later manual cleanup
or retention job should exclude rows with `suspendedAt` set; deleting those rows
would remove the reset requirement. An email in this table is not proof of an account.

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
await app.auth.revokeAllTokens(user);
```

Revocation sets `revokedAt`; the next bearer-token authentication rejects the
session before loading its user. `tokensFor(...)` excludes revoked and expired
sessions. The current authenticated token is available as `app.auth.token`
inside the request context so an app can mark the current browser session.

`revokeAllTokens(user)` implements **Log out all devices**. The app must authorize
the supplied account first; never accept a user id from the request as authority.
It revokes all previously unrevoked tokens, including expired rows, and returns
the number of rows changed. Revoked rows remain available for audit. Authentication
cached in the calling request is invalidated and the current user is cleared
when that account is logged out. Other requests already in progress may finish;
subsequent authentication rejects the old tokens. A new sign-in can create a new
session. This does not disconnect existing application-owned streams or revoke
external provider credentials. Show failures and retain browser state if the
all-devices request fails; clear browser credentials after successful confirmation.

## Security Responsibilities

The auth package validates credentials and tokens, but the application still
owns HTTP security controls:

- Rate-limit public sign-in, sign-up, provider, forgot-password, and reset routes.
  The password provider's per-identity suspension complements, and does not replace,
  these IP limits.
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

The lab verifies account-wide logout and automatic revocation after password
reset. The service's SQL regression tests additionally cover concurrent reset
redemption, transaction rollback and cross-account isolation. Concurrent
registration is a separate workflow. The website's Auth page includes the
exact lab test to copy into an independent application.

Run the auth package tests from the repository root:

```sh
npm run test:service --workspace packages/app -- auth
npm run check --workspace packages/app
```
