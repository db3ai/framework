# @db3.ai/create

Creates an independent Vue/DOM Studio + Fastify app using `@db3.ai/app`.
The starter has password registration/login, private notes and optional AI note
summaries. The developer supplies their own server-side OpenAI key.

## Develop the starter in this repository

`apps/starter` is the runnable application and the single source for generated
apps. Use it to try framework features through real routes, screens, models and
tests. Keep the initial login and notes journey simple; add optional feature
examples without requiring every external service just to start the app.

The default app layout is `client/` for the browser application and `server/`
for the backend, with committed migrations under `server/database/` and behaviour
tests under `tests/`. Generated apps preserve that same structure.

Generated apps also include a root `AGENTS.md`. It directs AI coding tools to
the installed `@db3.ai/app/agent-instructions` export and carries the concise
framework naming rules, including PascalCase for class-owning TypeScript files
and Vue components. Application-specific product instructions can be added
outside the marked framework block.

The app registers framework service commands in `server/cli.config.ts`.
Its database npm scripts invoke the framework-owned `db3` executable.

From the repository root, with Node.js 24 or newer:

```sh
npm ci
cp apps/starter/.env.example apps/starter/.env
```

Configure the dedicated application database and test account described in
`apps/starter/README.md`, then run from the repository root:

```sh
npm run db:migrate --workspace db3-starter
npm run dev:starter
```

The workspace resolves `@db3.ai/app` and `@db3.ai/pure` to local framework source.
Run `npm run build --workspace db3-starter` and `npm test --workspace db3-starter`
to check the application. Its `.env` supplies the separate `TEST_DB_*` settings.
No AI key is required for login, notes or automated tests.

The starter declares the shared Tiptap core and ProseMirror runtime used by DOM
Studio and deduplicates them with Vue in Vite. This keeps DOM Studio's nested
editor extensions on one runtime in both workspace and independent installs.
The starter overrides DOM Studio's older code-block and table extension pins
to patched Tiptap releases. The public framework workspace carries the same
overrides at its root, where npm applies workspace dependency overrides.

The creator runs directly from source too:

```sh
node packages/create/bin/create.mjs ../my-app --no-install
```

Before npm publication, that independent app still needs the matching framework
packages from the preview instructions below. Workspace development does not
prove that a published package contains all required files and dependencies.

Packaging includes a clean copy of `apps/starter` under the released creator's
`template/` directory. Do not maintain a second template in source. The shared
file selector excludes local credentials, installs, build output and runtime
artifacts, and rejects symbolic links and unreviewed source roots.

## Release command

**Not published yet.** Once Create, App and Pure are published together:

```sh
npm create @db3.ai@latest my-app
```

Use local MariaDB by default. The command creates files, waits for local database
configuration, installs packages, migrates and starts development. `-- --docker`
starts the bundled MariaDB 11.8 container instead, supporting native vectors.
`-- --no-install` only creates files; `-- --no-start` installs and migrates without
starting development.
Existing target paths are refused. No credential from the creator's environment
is written into the new app. `OPENAI_API_KEY` is always initially empty.

## Test the unpublished preview

From this framework checkout:

```sh
npm run framework:package
npm pack ./dist/framework-packages/pure --pack-destination ./dist/framework-packages
npm pack ./dist/framework-packages/app --pack-destination ./dist/framework-packages
npm pack ./dist/framework-packages/create --pack-destination ./dist/framework-packages
```

Give preview users the three tarballs. Outside this repository, replace the
absolute paths below with their locations:

```sh
npm exec --yes --package=/path/to/db3.ai-create-0.1.0.tgz -- create-db3 my-app --no-install
cd my-app
npm install /path/to/db3.ai-pure-0.1.0.tgz /path/to/db3.ai-app-0.1.0.tgz
```

Then follow the generated README for database setup, migrations, development,
tests and optional AI. These preview installs record local tarball paths; replace
them with released versions before sharing the resulting app with others.

Run creator safety tests with `node --test packages/create/tests/*.test.mjs`.
The generated `tests/app.test.ts` exercises the actual starter against disposable
SQL databases and mocks only OpenAI HTTP. Consumer checks must use packed
framework/creator artifacts and the published DOM Studio package, never sibling
workspace aliases. Docker validation is separate from native MariaDB validation.

Create is included in the framework-only public source export. The source
workspace remains private in npm metadata to prevent accidental publication;
the three-tarball preview above still works. It is not an npm release.

Release TODO: npm publishing for Create, existing framework
release gates, DOM Studio redistribution terms, and a documented production
deployment. This package does not publish or deploy any app automatically.

Generated apps include `AGENTS.md` for human and agent collaboration and
`plans/README.md` for disposable ideas. Only the planning policy is copied;
workspace drafts are excluded from generated apps and public source exports.
