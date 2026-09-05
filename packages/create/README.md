# @db3.ai/create

Creates an independent Vue/DOM Studio + Fastify app using `@db3.ai/app`.
The starter has password registration/login, private notes and optional AI note
summaries. The developer supplies their own server-side OpenAI key.

## Release command

**Not published yet.** Once Create, App and Pure are published together:

```sh
npm create @db3.ai@latest my-app
```

Use local MariaDB by default. The command creates files, waits for local database
configuration, installs packages, migrates and starts development. `-- --docker`
starts the bundled MariaDB container instead. `-- --no-install` only creates
files; `-- --no-start` installs and migrates without starting development.
Existing target paths are refused. No credential from the creator's environment
is written into the new app. `OPENAI_API_KEY` is always initially empty.

## Test the unpublished preview

From this framework checkout:

```sh
npm run framework:package
npm pack ./dist/framework-packages/pure --pack-destination ./dist/framework-packages
npm pack ./dist/framework-packages/app --pack-destination ./dist/framework-packages
npm pack ./packages/create --pack-destination ./dist/framework-packages
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

Release TODO: staging/publishing for Create, existing framework
release gates, DOM Studio redistribution terms, and a documented production
deployment. This package does not publish or deploy any app automatically.
