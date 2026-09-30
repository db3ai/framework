# Your DB3 app

The optional desktop experiment lives in `electron/` in the framework checkout.
See its README to run the same client in Electron. It is excluded from generated
web applications and has its own dependency installation and test runner.

## Feature apps: add a folder, then install

Social lives in `apps/social/` with a root `manifest.json` and `App.ts`. It owns
its models, routes, migrations, optional shared contracts and browser component.
DB3 discovers local folders and marked npm dependencies automatically. No per-app
host registration, navigation or CSS edits are needed.

Configure the database and set `APP_ADMIN_EMAIL` in `.env` to your administrator
account. Run `npm run db:migrate` and `npm run dev`, sign in with that account,
then open **Apps → Install**. Social appears in navigation immediately. Save a
discussion, mark it answered, reload, and explore its About sublink and definition.
The menu comes from each enabled app's `navigation(context)` method. Social's
saved-opportunity badge is private to the signed-in person and updates after
saves and status changes. The generic host also refreshes on window focus or
**Refresh navigation**; no per-app host wiring is required.
This example saves private bookmarks; it does not search or post to platforms.

The configured administrator can install, disable, enable and uninstall through
the Apps screen in this single-process Starter. Production requires explicit
`APPS_MANAGE_ONLINE=true`; leave it disabled when workers or replicas use the
apps. In that case stop every consumer and use the same actions through the CLI:

```sh
npm run db3 -- apps:list
npm run db3 -- apps:install social
npm run db3 -- apps:disable social
npm run db3 -- apps:enable social
npm run db3 -- apps:uninstall social
```

`app().social` is the optional public service. `npm run check` generates its types
in `.db3/apps.d.ts`; the Vite plugin discovers browser entries. App models stay
out of the host snapshot. Each owns prefixed tables, immutable `.mjs` migrations,
its snapshot and its ledger. Generate changes with
`npm run db3 -- apps:make-migration social change_name`, review and commit them,
bump the manifest/package version, then install during maintenance. The app owns
both `up()` and `down()`: generated down functions deliberately refuse rollback
until an author supplies and tests a reversal before first installation. After
disable, `apps:rollback social` runs the latest authored down once. Uninstall
keeps data and never runs down implicitly.

To emulate npm extraction, stop consumers and run from the host root:

```sh
npm pack ./apps/social --pack-destination /tmp
mv apps/social /tmp/social-source
npm install /tmp/db3.ai-social-0.1.0.tgz
```

Use an unused extraction destination. The private example is not published. Its
package marker (`db3.app: true`), exported package.json and root manifest allow
automatic discovery. No host imports change. Rebuild/restart, then install from
the Apps screen or CLI; identical versions retain the same migration history.
Never keep the local and packaged copies in discovery together.

For removal, uninstall while the code is still present, then delete its local
folder or run `npm uninstall @db3.ai/social`. Rebuild the browser and restart the
host after code changes. Reinstall a compatible copy to recover retained records.
No npm lifecycle hook touches SQL. Stop all consumers for CLI maintenance.

`client/AppWorkspace.vue` is the supplied catalog, navigation and management UI;
other frontends can implement the same Apps contracts. The framework Apps guide
covers custom host integration, lifecycle hooks, dependency generations and npm
packaging. Run `npm test` for local auth/lifecycle checks; in the framework repo,
`npm run framework:apps:test` verifies the actual package installation and removal.

## Live rooms and collaborative whiteboard

Apply migrations (`npm run db:migrate`), start the app and open **Live rooms** in
two tabs. Try chatting, drawing, moving your pointer and leaving a room. Refresh
to restore committed drawings and the latest 50 chat messages from SQL.

- **Public lobby:** anonymous sockets, including when a visitor is signed in.
- **Signed-in members:** existing HttpOnly session cookie authentication.
- **Gated studio:** sign in, then enter the demo invitation `draw-together`.
  Configure `DEMO_ROOM_CODE` before sharing a deployment. Grants are stored in SQL
  and checked on every socket action/send, separately from authentication.

`server/collaboration/RoomController.ts` contains controller actions, validation,
room-local presence and bounded persistence. `registerCollaboration.ts` mounts
exact endpoints and extracts cookies on the server; HTTP route hooks do not run
on upgrades. `client/CollaborationDemo.vue` owns the browser client and drawing UI.
The Vite proxy forwards `/ws` upgrades; configure the production proxy likewise.

The whiteboard saves complete gestures on pointer release (up to 200 points each,
500 strokes per room). Cursors and tab-level presence are not persisted. Guest
names are display names, not verified identities. Public content is shared with
everyone in the lobby. Disconnected changes are not queued or replayed.

This demo uses one API writer. Channels and presence are process-local. During
blue/green replacement, drain old sockets so they reconnect and reload; broadcasts
cannot cross the overlap, and multiple simultaneous room writers need additional
coordination. Add abuse controls, retention and real invitation management before
using these public writable rooms as a production collaboration product.

The private `/ws/inbox` endpoint demonstrates `inbox:${userId}` channels selected
by trusted server code. Demo sends and recipient state changes publish an
invalidation after persistence; clients reload the authorized inbox. Jobs in a
separate process need a future cross-process delivery adapter. There is no
automatic dependency from the framework InApp service to WebSockets.

Sign in, save a private note, then summarise it with AI. This is your application
code. Change the models, routes and screens to build your own features.

In the framework repository, this app lives at `apps/starter` and also serves as
the framework feature playground. Run package commands from this directory or
add `--workspace db3-starter` when running them from the repository root. Local
workspace installs use the framework source. Apps generated by the creator use
the matching packaged framework version.

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

Password sign-in suspends an email after 20 failed attempts, including unknown
emails, until verified password recovery. The demo returns the same
`429 too_many_attempts` response for either case. Its migrations include the
framework's independent attempt table, including readable submitted emails and
activity timestamps. Records have no automatic deletion; preserve suspended rows
in any manual cleanup so password recovery stays mandatory. Before accepting real accounts, add a
recovery email flow using `Auth.createPasswordResetToken` and `Auth.resetPassword`
as described in the [authentication guide](https://db3.ai/docs/auth); this demo
does not include a recovery email transport or reset screen. Google sign-in and
existing sessions remain available during password suspension.

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
CREATE DATABASE `db3-starter` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'db3_starter'@'127.0.0.1' IDENTIFIED BY 'replace-with-your-local-password';
GRANT ALL PRIVILEGES ON `db3-starter`.* TO 'db3_starter'@'127.0.0.1';
```

From the application directory, copy `.env.example` to `.env` only if `.env` does
not already exist. Preserve existing app settings. In the framework repository,
this file is `apps/starter/.env`; generated apps keep it at their root.
Set these values, using the same password you chose in SQL:

```dotenv
DB_CONNECTION=mariadb
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=db3-starter
DB_USER=db3_starter
DB_PASSWORD=replace-with-your-local-password
```

The database and login have different names. Quote the hyphenated database name
with backticks in SQL. `127.0.0.1` uses TCP, not the database's Unix socket.
Keep `.env` out of Git. Remove an inherited `DATABASE_URL` from your shell if it
would override these settings. Never use an existing application's database.

Run from the application directory:

```sh
npm run db:migrate
npm run db:check
npm run dev
```

Migrations create tables inside the database; they do not create its database or
login. The check should report `matches: true` with no pending migrations.
Restart an already-running dev server after editing `.env`.

For connection-refused errors, check MariaDB is running on port 3306. For access
denied, check the password and TCP account host. For an unknown database, check
that database creation succeeded and `DB_DATABASE` matches its name.

## Optional Docker database

The creator's `--docker` option generates a random database password and starts
MariaDB 11.8 with Docker Compose. This is the minimum supported version for the
planned guided setup's native vector storage and similarity search. The Node app
still runs locally. Docker is not a requirement for manual development setup.

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

The bundled image now uses the 11.8 release series. Existing 11.4 databases need
a backed-up, verified upgrade before reusing their data volume with the new image;
changing this template does not upgrade an existing installation automatically.

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
tokens. The framework client has a 60-second timeout and no automatic retry.
The demo allows one active request per user, four overall and ten attempts per
user per minute. These limits are in memory, reset on restart and are **not a
spending cap**. Set provider limits before sharing an AI-enabled app publicly.
`store: false` disables provider response storage, not local tracking or all provider retention.
AI requests, responses and usage are saved through `AiRequest`, with
`AiConversation` and `AiMessage` for history. The committed migrations include
these models and the shared provider rate-limit tables. See the
[AI guide](https://db3.ai/docs/ai) to add agents, tools, images or embeddings.

Missing key: notes still work, and the button explains setup. Wrong key, quota,
network or model failure: a safe error appears without exposing provider data.
A timeout can still incur cost. Do not automatically retry chargeable requests.

## Where to build

New DB3 apps use `client/` for the browser application and `server/` for the
backend. The starter uses this layout in the framework workspace and in every
generated app.

```text
client/main.ts                   Browser entry point
client/App.vue                   Landing, login and the protected notebook
client/api.ts                    Browser calls to the server API
client/style.css                 Application styles
server/config.ts                 Server configuration; public values are explicit
server/app.ts                    Framework services and password/Google provider config
server/cli.config.ts             Service command registration for the framework CLI
server/models/Note.ts            Field definitions, validation and storage
server/http/createServer.ts      Auth, note ownership and HTTP routes
server/ai/summariseNote.ts        Application-owned prompt and authorization
server/database/models.ts        Complete model registry for migrations
server/database/migrations/      Committed migrations
server/database/schema.snapshot.json    Model schema baseline
tests/app.test.ts                Real Auth/SQL tests; simulated external AI
```

The browser accesses the database through the server API in both development
and production. Migration commands are server-side operations. Include the
committed migrations and schema snapshot with the server deployment, and run
`npm run db:migrate` before starting the new server version.

The `db3` executable belongs to the framework. `server/cli.config.ts` supplies
the app factory and registers its database commands; there is no app-owned
command parser or CLI entry point. Run `npx db3 --help` from the app root to see
available commands. The existing npm database scripts invoke that shared CLI.

Run `npx db3 repl` or `npm run repl` to explore the app in a terminal. The REPL
boots the same app and loads this project's model registry, so `app()`, `Note`
and `models.Note` are ready to use:

```js
await Note.query().limit(5).all()
await app().db.migrations.status()
```

Use `.exit` or Ctrl+D to quit; the CLI closes the app's resources. Expressions
are JavaScript and support top-level `await`. Run other commands through the
same executable, such as `npx db3 db:migrate`, or the npm shortcut
`npm run db3 -- db:check`.

The app passes only its model registry with `dbOptions: { migrations: { models } }`,
making `app().db.migrations` available to commands, tests and server operations.
The framework uses `server/database/migrations/` and
`server/database/schema.snapshot.json` by convention. There is no `migrations.ts`
configuration file. `server/app.ts` anchors the app directory to its own location,
so commands and tests use the same files even when launched from elsewhere.

The example uses `@db3.ai/app/ai`, `/auth` and `/db` public imports. To add a
nullable subtitle, add this entry to the `fields` factory inside `ActiveRecord.define()` in `server/models/Note.ts`:

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

New models use `class ModelName extends ActiveRecord.define({ table, fields }) {}`.
The field factory infers properties and constructor/`create()` inputs, so no
matching `declare` properties are needed. Keep methods in the class body and
options such as `requestFillable` in the definition. Required fields can still
be null in memory before validation. `Model.create()` returns an unsaved record;
call `save()` to persist. See the [ActiveRecord guide](https://db3.ai/docs/active-record).

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
Tests and setup/cleanup hooks have a 30-second limit because integration cases
create and migrate real databases, including the packed generated-app checks.
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
onboarding, organisations, billing, shared application spending limits,
or a production deployment recipe. Review registration abuse controls, CSP,
backups, monitoring and secret management before public use. Do not describe the
demo as a complete production SaaS.

The starter's npm overrides update DOM Studio's pinned code-block and table
extensions to patched Tiptap releases. Keep these overrides when creating an app
from this starter; the public framework workspace also applies them at its root.

The framework is MIT licensed. DOM Studio is a separate dependency with its own
licence, not relicensed by this starter. See [DOM Studio](https://getdom.studio).

## Notification inbox demo

After applying migrations with `npm run db:migrate`, start `npm run dev` and sign in.
Above the notebook, use **Send inbox message**, **Send toast** or **Send banner**.
The Notifications badge opens your stored inbox and shows its unread count.

- Inbox messages stay in the inbox without an alert.
- A new demo toast fades after six seconds; reloading does not replay old toasts.
- Banners survive reloads until **Dismiss banner** is clicked. Dismissal does not mark
  the item read or remove it from the inbox.
- **Mark read**, **Mark unread** and **Archive** persist independently. Load older
  messages with the pagination button. Opening the inbox or clicking **Refresh**
  fetches current state over HTTP. A private WebSocket channel now invalidates the
  inbox in other connected tabs after the demo's send and state-change routes.
  Reconnection also reloads the inbox. This does not replay old toasts.

`client/NotificationInbox.vue` renders typed content with DOM Studio: `DomToastStack`
owns transient toast animation and expiry, `DomAlert` renders persistent banners,
and `DomCard`, `DomBadge` and `DomButton` provide the inbox controls. Banner
dismissal waits for the server so a failed write leaves the banner visible. `server/http/inApp.ts` uses
framework session authentication and `application.inApp`; it never trusts a browser
recipient ID. The demo producer only sends fixed content to the signed-in user.
`InAppRecord` is included in the model registry and committed migration workflow.
No email, push provider or AI key is needed for this demo.
