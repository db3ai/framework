# Your DB3 app

Sign in, save a private note, then summarise it with AI. This is your application
code. Change the models, routes and screens to build your own features.

## Run locally

Use Node.js 24+, npm and MariaDB. Docker is optional. The creator writes `.env`
with an empty `OPENAI_API_KEY`; you do not need AI credentials to run this app.

If you used the creator's default interactive setup, it installs dependencies,
applies committed migrations and starts development once you configure `.env`.
For a generated-only project (`--no-install`), complete database setup below, then:

```sh
npm install
npm run db:migrate
npm run dev
```

Open [localhost:5173](http://localhost:5173). Create an account with a password
of at least 12 characters, save a note and reload the page. The note survives
because it is stored in MariaDB. Sign out and sign back in to see it again.
A second account cannot read, delete or summarise the first account's notes.

The Vite frontend runs on 5173 and proxies `/api` to Fastify on 3001. If you change
ports, update `PORT`, `APP_ORIGIN` and `vite.config.ts` together. Use exactly the
origin configured in `.env`; `localhost` and `127.0.0.1` are different origins.

## MariaDB on your machine

On macOS with Homebrew:

```sh
brew install mariadb
brew services start mariadb
mariadb
```

Use MariaDB's [installation instructions](https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb)
for other platforms. From an administrator SQL session, create a database and
an app-specific TCP account. Replace the example password before running:

```sql
CREATE DATABASE db3_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'db3_app'@'127.0.0.1' IDENTIFIED BY 'replace-with-your-local-password';
GRANT ALL PRIVILEGES ON db3_app.* TO 'db3_app'@'127.0.0.1';
```

Set `DB_PASSWORD` in `.env` to your chosen password. `DB_HOST=127.0.0.1` uses
TCP, not the database's Unix socket. Do not point the starter at an existing
application database. Remove any inherited `DATABASE_URL` from your shell,
because it takes precedence over the individual `DB_*` settings.

## Optional Docker database

The creator's `--docker` option generates a random database password and starts
MariaDB with Docker Compose. The Node app still runs locally. Docker is not a
requirement for development.

Install Docker with Compose support. The creator also recognises the standalone
`docker-compose` command used by some Homebrew setups; use that spelling in the
commands below if your installation does not expose `docker compose`.
The engine must run locally: a remote Docker context publishes the database port
on the remote host, not on this computer. The creator refuses remote endpoints.

To use Docker after generating with `--no-install`, set `DB_PORT=33067` and a
non-empty `DB_PASSWORD` in `.env`, then run:

```sh
docker compose up -d --wait db
npm install
npm run db:migrate
npm run dev
```

`docker compose stop` stops the database while retaining its volume. Do not use
`docker compose down -v` unless you intend to delete its data. Changing a password
in `.env` does not reset credentials in an existing database volume.

## Add your own AI key

Put your own OpenAI API key in the **server's** `.env`:

```dotenv
OPENAI_API_KEY=your-own-key
OPENAI_MODEL=gpt-4.1-mini
```

Restart `npm run dev`, sign in and click **Summarise with AI** on a saved note.
The key belongs to the developer running this app, not every end user. No key is
bundled with DB3 or copied from another application. Do not commit it, put it in
Vue code, or use a `VITE_` environment variable for it.

Only the chosen note is sent to OpenAI. The summary is shown separately and is
not saved over the original. Provider charges apply. Review the output; it can
be wrong. Choose a Responses-compatible model available to your OpenAI project.

The route limits input to 20,000 characters plus the title and output to 400
tokens. The framework client has a 30-second timeout and no automatic retry.
The demo allows one active request per user, four overall and ten attempts per
user per minute. These limits are in memory, reset on restart and are **not a
spending cap**. Set provider limits before sharing an AI-enabled app publicly.
`store: false` disables stored Responses, not all provider data retention.

Missing key: notes still work, and the button explains setup. Wrong key, quota,
network or model failure: a safe error appears without exposing provider data.
A timeout can still incur cost. Do not automatically retry chargeable requests.

## Where to build

```text
server/config.ts                 Server configuration; public values are explicit
server/app.ts                    Framework services and password/Google provider config
server/models/Note.ts            Field definitions, validation and storage
server/http/createServer.ts      Auth, note ownership and HTTP routes
server/ai/summariseNote.ts        Application-owned prompt and authorization
server/database/                 CLI and model registry
database/migrations/             Committed migrations
database/schema.snapshot.json    Model schema baseline
src/App.vue                      Landing, login and the protected notebook
tests/app.test.ts                Real Auth/SQL tests; simulated external AI
```

The example uses `@db3.ai/app/ai`, `/auth` and `/db` public imports. To add a
nullable subtitle, add this entry to the object returned by `Note.fields()`:

```ts
subtitle: field.string({ required: false, maxLength: 160 }),
```

Fields use `required: false`, not `nullable: true`. Add `declare subtitle: string
| null;` to the class if you want typed property access. To accept it from the
browser, also add `subtitle` to `requestFillable`, the note HTTP body schema and
the form. Optional schema-only fields do not require those UI changes.

Then run:

```sh
npm run db:make:migration -- add_note_field
# Review the generated migration and snapshot before applying.
npm run db:migrate
npm run db:check
```

Finish applying the migration before checking the changed app, then reload the
browser. During development, the server may reload your model before its new
column exists and temporarily return a request error. If that happens, complete
`db:migrate`, confirm `db:check` passes and reload; server hot reload does not
apply database migrations.

`db:make:migration` first runs `npm run check`. Invalid field options must fail
type checking before the generator writes a migration. Generation is not a
substitute for reviewing data loss, backfills and existing records.

Commit the migration and snapshot together. Do not edit an applied migration.
Server startup never installs or changes the schema.

## Google and other sign-in methods

`server/app.ts` shows where Google client IDs configure the built-in provider.
The shipped browser flow is password registration/login only. Setting
`GOOGLE_AUTH_CLIENT_ID` alone does **not** add a working Google button. The next
recipe is wiring Google Identity Services to an origin-checked route that calls
`application.auth.issueTokenForProvider('google', { credential })` and issues
the same session cookie. Follow the [Auth guide](https://db3.ai/docs/auth).
Other social providers need an explicit provider driver; they are not implied.

## Test your app

```sh
npm run check
npm run build
npm test
```

Tests use real MariaDB and committed migrations, with uniquely named
`db3_app_test_*` databases that are removed afterwards. Set `TEST_DB_HOST`,
`TEST_DB_PORT`, `TEST_DB_USER` and `TEST_DB_PASSWORD` in `.env` to a dedicated
test account with CREATE/DROP permissions for that namespace. For example:

```sql
CREATE USER 'db3_test'@'127.0.0.1' IDENTIFIED BY 'replace-with-your-test-password';
GRANT ALL PRIVILEGES ON `db3\_app\_test\_%`.* TO 'db3_test'@'127.0.0.1';
```

The Docker app account has privileges only on its app database, deliberately.
Create a separate test account using an admin session, or use a separate local
test server. Missing test infrastructure fails; tests do not silently skip.
All AI tests use a dummy key and a simulated HTTP response. They do not use your
real API key or incur AI charges. The summary shown in tests is a fixture, not
evidence that a live provider was called.

## Before public deployment

Build with `npm run build`, apply migrations in a release step, and run
`NODE_ENV=production npm start` behind HTTPS. Set `APP_ORIGIN` to the exact HTTPS
origin and configure `HOST`/`PORT` for your reverse proxy. Production uses secure,
HttpOnly, SameSite cookies; writes require the exact Origin header. It serves
the built frontend and API from the same server.

This first starter does not include password-reset screens, verified-email
onboarding, organisations, billing, durable AI accounting, shared rate limiting,
or a production deployment recipe. Review registration abuse controls, CSP,
backups, monitoring and secret management before public use. Do not describe the
demo as a complete production SaaS.

The framework is MIT licensed. DOM Studio is a separate dependency with its own
licence, not relicensed by this starter. See [DOM Studio](https://getdom.studio).
