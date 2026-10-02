import type { DocArticle } from '../docs';
import { serviceExampleSources } from '../generated/service-examples';
import { serviceLabEvidence, serviceLabSamples, serviceLabTesting } from './serviceLab';

const evidence = serviceLabEvidence('auth', 'runPasswordAuth', 'Exercises password registration, valid/invalid sign-in, bearer authentication, reset-token reuse and session revocation.', 'A dedicated MariaDB/MySQL test account with CREATE/DROP privileges. No email or Google requests.');

export const authArticle: DocArticle = {
	id: 'auth', area: 'services', group: 'Application', label: 'Auth', title: 'Auth',
	summary: 'Give an account one or more login methods. Issue bearer sessions, reset passwords and revoke access without mixing identity with credentials.',
	packageName: '@db3.ai/app/auth', sourcePath: 'packages/app/src/auth/README.md',
	examplePaths: ['packages/app/src/auth/examples/runPasswordAuth.ts'], testPath: evidence.testPath, verifiedExample: evidence,
	sections: [
		{ id: 'setup', title: 'Set up accounts and providers', paragraphs: [
			'An account is a `UserIdentity`. A password or Google login is an `AuthProvider` attached to that account. `AuthToken` represents a bearer session; `PasswordResetToken` represents an expiring reset request.',
			'Create one App and enable password authentication under `config.auth.providers.password`. The example uses the built-in identity model. To add application fields, extend `UserIdentity`, retain its inherited fields, and pass your class through `auth.identityModel`.',
			'Your application schema needs the identity, provider, auth-token and reset-token tables. The lab installs them only into its disposable database. Use committed migrations for an application; do not install or reshape tables in a sign-in request.',
		], links: [{ label: 'Install packages and configure a test database', articleId: 'installation', sectionId: 'database-labs' }, { label: 'App and request context', articleId: 'app' }] },
		{ id: 'copy', title: 'Copy the working example', paragraphs: ['Start in the independent app directory from Installation. This copies a complete lab, including setup and cleanup. The example credentials are local test data, not a default administrator account.'], codeSampleId: 'copy-lab' },
		{ id: 'run', title: 'Run the auth workflow', paragraphs: ['The result contains only Boolean outcomes, all true. It never prints passwords, bearer tokens or reset tokens. No email is sent. A new test database is created and removed on every run.'], codeSampleId: 'run-lab' },
		{ id: 'passwords', title: 'Register and sign in', paragraphs: [
			'`registerWithPassword()` creates the account, password provider and first bearer session. `issueTokenForProvider("password", credentials)` authenticates an existing account and creates another session. Invalid credentials return null; a duplicate identity or missing provider configuration raises an error.',
			'Passwords are hashed on the provider record and hidden from JSON. Treat submitted data as untrusted: validate the raw request before registration, rate-limit the endpoint and return a generic invalid-credentials response.',
		], codeSampleId: 'auth-source' },
		{ id: 'sessions', title: 'Authenticate and revoke sessions', paragraphs: [
			'An issued token contains the plaintext bearer value once. Set a lifetime with `expiresInMs` or `expiresAt`. Return it only through your deliberate session transport, and do not log the issued object.',
			'At the HTTP boundary, extract the bearer token and call `authenticateToken()` inside `requestContext.run()`. A null result means 401. Use `requireUser()` only after authentication. Current user/token state and repeated authentication are scoped to that request.',
			'`tokensFor(user)` lists active sessions. Render `toSessionData()` for account settings. `revokeToken(user, sessionId)` checks ownership; `revokeCurrentToken()` revokes the token authenticated in the current request. Use `revokeAllTokens(user)` to log out all devices after authorizing the account. `logout()` only clears authentication state, so it is not a substitute for durable revocation.',
		] },
		{ id: 'reset', title: 'Reset a password', paragraphs: [
			'Find the account without revealing whether its email exists. Call `createPasswordResetToken(user)`, then send the plaintext token through your email service. Redeem it with `resetPassword({ token, password })`; an expired, invalid or already-used token returns null.',
			'A successful `resetPassword()` or `changePasswordProvider()` replaces the password, invalidates all outstanding password-reset links and revokes every bearer session in one database transaction. This includes the current device: clear browser credentials and return to sign-in after success.',
			'The example checks all-device logout, then creates a fresh session and verifies that a password reset revokes it. It also rejects reuse of the reset token. Concurrent reset redemption and atomic registration are not covered by this lab.',
		] },
		{ id: 'providers', title: 'Google and additional login methods', paragraphs: [
			'Enable the Google provider with the accepted client IDs, then pass a Google Identity Services `credential` to `issueTokenForProvider("google", input)`. The driver verifies that ID token; access/refresh tokens for Google APIs are a separate integration.',
			'Do not merge accounts just because emails match. An existing account without that provider triggers `AuthIdentityExistsError`. Require the signed-in user to link the provider explicitly with `linkProvider()`. List safe settings data through `providersFor()` and `toSummary()`; `unlinkProvider()` refuses to remove the final login method.',
			'Custom drivers implement `AuthProviderDriver.verify()` and return a normalized profile. They prove identity; Auth owns accounts and sessions. The source-backed reference includes Google setup, provider configuration and the complete custom-driver shape. This lab does not call Google or implement a magic-link provider.',
		] },
		{ id: 'production', title: 'Run Auth behind your application routes', paragraphs: [
			'Auth does not create HTTP routes, choose cookie settings or supply a login UI. Your server must own input validation, rate limiting, HTTPS, trusted proxies, generic recovery responses and authorization after sign-in.',
			'For cookie sessions, choose Secure, HttpOnly and SameSite settings and add CSRF protection for state-changing requests. Do not assume a bearer token in localStorage is protected from injected JavaScript. Require recent authentication before linking or removing a login method.',
		], links: [{ label: 'Run the HTTP application', articleId: 'create-app' }, { label: 'Store application records', articleId: 'active-record' }] },
		serviceLabTesting('auth', 'runPasswordAuth'),
		{ id: 'run-tests', title: 'Run and extend the test', paragraphs: ['Run the copied test with the test database configured. Then change a password, try a used reset token, or revoke a session and authenticate it in a new request context. These are real database operations and real password hashes, not mocked authentication.'], codeSampleId: 'test-lab' },
		{ id: 'coverage', title: 'Coverage and next steps', paragraphs: ['Tested here: password registration, sign-in, invalid credentials, bearer authentication, password reset, sequential reset-token reuse rejection and revocation. Explained: custom identities, session projection, provider linking, Google and HTTP security boundaries.', 'The starter guides now trace rate-limited HTTP login, cookies, logout and private note access. Email/reset delivery, concurrent registration/reset and live Google sign-in still need separate trials. The source-backed service reference and emitted API below cover advanced contracts.'], links: [{ label: 'Cookie-session login walkthrough', articleId: 'guide-auth' }, { label: 'Authenticated notes API', articleId: 'guide-api' }, { label: 'Auth API', articleId: 'auth-api' }] },
	], codeSamples: [...serviceLabSamples('auth', 'runPasswordAuth'), { id: 'auth-source', title: 'examples/runPasswordAuth.ts', language: 'typescript', code: serviceExampleSources.runPasswordAuth }],
	relatedIds: ['installation', 'create-app', 'active-record', 'mail'],
};
