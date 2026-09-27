# Mail

`@db3.ai/app/mail` provides a small provider-independent boundary for
outbound application email. It checks that recipients and body content are present, resolves
a default sender, and delegates delivery to an injectable `MailTransport`.

The service owns message normalization and the built-in file, Mailgun, and
Resend transports. Applications own templates, localization, recipient policy,
queueing, and deciding which business event should send a message. Sending is
immediate; use the Queue service when delivery must be durable or retried.

## Run a welcome email without sending it

Install the package using the [installation guide](https://db3.ai/docs/installation). During the unpublished preview, use matching App and Pure tarballs. Then copy the installed examples:

```sh
npm install --save-dev tsx typescript @types/node vitest
mkdir -p examples
cp -R node_modules/@db3.ai/app/src/mail/examples/. examples/
npx tsx examples/runMailPreview.ts
```

The command uses a real `FileMailTransport` in its own temporary directory. It rejects an empty recipient list, writes one welcome message for `ada@example.test`, reads it back and removes only that directory in `finally`. It makes no network requests, even if provider credentials exist in your environment.

Expect `transport: "file"`, `files: 1`, `rejectedEmptyRecipients: true` and the subject `Welcome to your notes`. The HTML body contains `Ada &amp; team`; the text body keeps `Ada & team`.

[`welcomeMessage.ts`](./examples/welcomeMessage.ts) owns application input validation and HTML text escaping. `Mail` does not validate email addresses, sanitize headers, or escape your HTML. Escape values for the context where they are inserted; HTML text escaping is not URL validation or a general HTML sanitizer. Do not expose an unrestricted public send-mail endpoint.

The complete [Mail walkthrough](https://db3.ai/docs/mail) includes both source files and the copyable consumer test. Copy its test into `tests/mail/runMailPreview.test.ts`, then run:

```sh
npx vitest run tests/mail/runMailPreview.test.ts
npx tsc --noEmit --module ESNext --moduleResolution Bundler --target es2022 --types node --skipLibCheck examples/*.ts
```

Those tests use real file delivery and real Mail/Resend components with only the external `fetch` boundary replaced. They cover template validation, missing credentials, rejection before sending, provider failure and explicit retry. No live email delivery is claimed.

## Module Ownership

Mail is a service-owned module inside `packages/app`:

```text
mail/
	Mail.ts
	transports/
	tests/
	index.ts
	README.md
```

The module has no dependency on the framework `App`. Applications may construct
one `Mail` instance directly or expose it from their own `App` subclass through
the normal `service(...)` cache. The HTTP transports depend only on the runtime
`fetch` API, while the file transport uses the local filesystem.

## Public API

Import supported APIs from the package subpath:

```ts
import { Mail, createMailFromEnv, type MailDelivery, type MailMessage, type MailTransport } from '@db3.ai/app/mail';
```

The public surface includes:

- `Mail`, which resolves and sends `MailMessage` values.
- `MailAddress`, accepting either an address string or an `{ email, name }`
  object.
- `MailTransport`, the provider boundary applications can implement.
- `MailDelivery`, the normalized result returned after a successful send.
- `createMailFromEnv(...)` and `createMailTransportFromEnv(...)`, which apply
  the framework environment-variable convention.
- `FileMailTransport`, `MailgunTransport`, and `ResendTransport`.
- `formatMailAddress(...)` and `mailAddressEmail(...)` for transport authors.

`ResolvedMailMessage` is the transport-facing shape. It always contains a
resolved sender and an array of recipients, so custom transports do not need to
repeat that normalization.

## Configuration

`createMailFromEnv()` recognizes these common variables:

```env
MAIL_TRANSPORT=file
MAIL_FROM="Example App <no-reply@example.com>"
MAIL_FILE_DIRECTORY=storage/mail
```

`MAIL_TRANSPORT` supports `file`, `mailgun`, or `resend`. `MAIL_MAILER` is
accepted as a legacy fallback when `MAIL_TRANSPORT` is absent. An absent or
unrecognized value selects the file transport, keeping local development from
accidentally sending external email.

In production, validate `MAIL_TRANSPORT` against an explicit allowlist before constructing Mail. A typo otherwise selects file delivery and can look like a successful send. File messages are plaintext: keep the directory outside public storage, restrict access and set your own retention policy.

Mailgun requires:

```env
MAIL_TRANSPORT=mailgun
MAILGUN_API_KEY=key-example
MAILGUN_DOMAIN=mg.example.com
MAILGUN_BASE_URL=https://api.mailgun.net/v3
```

Resend requires:

```env
MAIL_TRANSPORT=resend
RESEND_API_KEY=re_example
RESEND_BASE_URL=https://api.resend.com
```

The base URL variables are optional and primarily useful for compatible
gateways and controlled tests. Credentials belong in the application's secret
store or deployment environment, never in committed configuration.

## Normal Workflows

Create one shared mail service during application boot:

```ts
import { createMailFromEnv } from '@db3.ai/app/mail';

const mail = createMailFromEnv(process.env, {
	from: 'Example App <no-reply@example.com>',
});
```

Send text, HTML, or both:

```ts
const delivery = await mail.send({
	to: {
		email: user.email,
		name: user.name,
	},
	subject: 'Reset your password',
	text: `Open ${resetUrl} to reset your password.`,
	html: `<p>Open <a href="${resetUrl}">this reset link</a>.</p>`,
});
```

The returned `MailDelivery` contains the provider message id, transport name,
normalized accepted and rejected address lists, and the written path for file
deliveries.

Applications can inject a transport explicitly. This is the preferred seam for
application tests and provider extensions:

```ts
const mail = new Mail({
	from: 'Example App <no-reply@example.com>',
	transport: new ApplicationMailTransport(),
});
```

The file transport writes one readable JSON record per message. It is the
default transport and is suitable for local inspection without contacting an
external provider.

## Errors And Failure Behaviour

`Mail.send(...)` rejects before invoking the transport when the recipient array
is empty or when neither `text` nor `html` content is present. A message-level
`from` value overrides the service default.

Environment construction fails immediately when the selected provider is
missing required credentials. Mailgun and Resend reject non-successful HTTP
responses with a provider-specific error message, while network failures
propagate to the caller. Invalid JSON falls back to the HTTP status text for a
rejection and an empty provider id for a successful response. A successful HTTP
response currently reports all submitted recipients as accepted because the
provider APIs used here do not return per-recipient status in this boundary.

The framework does not retry a failed send or persist an outbox. Dispatch a
dedicated queued job when the application needs retry policy, idempotency, or
delivery that survives process shutdown.

Queue retry alone does not prevent duplicate email. A timeout can follow provider acceptance. Set `MailMessage.idempotencyKey` to a stable request identity when using Resend. The transport forwards it as the API `Idempotency-Key` header, separately from email headers. Resend deduplicates identical requests for 24 hours; applications must preserve the exact payload and manage retries within that window. Keys accept 1–256 printable non-space ASCII characters. File and Mailgun transports ignore this field. Mail does not persist an outbox or promise exactly-once delivery across all transports. See [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

`accepted` means transport/provider acceptance, not inbox delivery. The built-ins have no attachments, CC/BCC, delivery tracking, scheduled sending or explicit request timeout. File and Resend preserve custom `headers`; Mailgun currently does not forward them. `App` has no built-in `mail` getter, and Mail has no close method. Own any resources introduced by your custom transport.

The [full API reference](https://db3.ai/docs/mail-api) is generated from the shipped declarations for Mail and all three transports.

## Testing And Verification

The service-owned behaviour tests exercise file output, message validation,
environment selection, Resend request formatting, and provider rejection:

```sh
npm run test:service --workspace packages/app -- mail
```

Run the complete framework suite and source checks before publishing a change:

```sh
npm test --workspace packages/app
npm run check --workspace packages/app
```

External mail APIs are controlled through the injectable transport or a stubbed
`fetch` boundary. Tests must not send live email. Relevant implementation lives
in [`Mail.ts`](./Mail.ts) and [`transports/`](./transports). Behavioural tests
live at `packages/app/src/mail/tests/` in the source repository and are not
included in the installed runtime package.

Resend and Mailgun HTTP submissions now reject redirects and have a 15-second
request timeout. A timeout may follow provider acceptance, so callers must still
use stable idempotency identities and tolerate at-least-once delivery.
