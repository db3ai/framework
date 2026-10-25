# Command line

`@db3.ai/app/cli` owns the shared `db3` executable, command help, positional
argument/option validation, output and application shutdown. Each service owns its
commands and calls the same programmatic operations used by application code.
Applications supply their factory, operational configuration and custom additions
in `server/cli.config.ts`.

## In a generated app

From the app root:

```sh
npx db3 --help
npx db3 list --json
npx db3 queue --pool=reports
npx db3 queue --once
npx db3 scheduler
npx db3 scheduler:list
npx db3 repl
npx db3 db:migrate
npx db3 db:check
npx db3 queue:make-job GenerateReportJob
npm run db:make:migration -- add_note_field
```

`queue` aliases `queue:work`; `scheduler` aliases `scheduler:work`. They start
workers and stay alive until SIGINT/SIGTERM requests orderly shutdown. Queue
finishes its active jobs and scheduler finishes its active tick before the CLI
closes its app. `queue --once` processes at most one available delivery. Existing
service consoles remain available during application migration.

Configure `queue.workers` in `server/cli.config.ts` for named pools. Use the
optional `prepareApp(application)` hook to register operational jobs/schedules
or call `application.apps.boot()` for installed nested apps. It runs once per
operational invocation. Help, discovery and database/source-generation commands
do not call it, so pending migrations cannot prevent maintenance operations.
Use `scheduler.checkpoint` and `scheduler.onTick` for app-owned durable progress
and health reporting. The service commands own their execution and validation.

The starter also provides `npm run repl` and `npm run db3 -- <command>`.
`npx` resolves the installed package executable; `node db3 repl` would require
an app-owned file called `db3`, which generated apps do not need.

## Explore the app

`npx db3 repl` starts a terminal session using the same `createApp` factory as
the other commands. It starts no HTTP listener. JavaScript expressions support
top-level `await` and variables persist between inputs:

```js
app().directory
await Note.query().limit(5).all()
await app().db.migrations.status()
```

The REPL loads the exported `models` array from `server/database/models.ts`
(`.mjs` and `.js` are also accepted). Named constructors are available directly,
such as `Note`, and through `models.Note`. Apps without this registry still have
`app()` and an empty `models` object. Duplicate and reserved model names fail
with an explanation. The app factory and registry share one TypeScript module
scope, preserving constructor identity and ActiveRecord's app context.

Use `.help` for Node REPL commands, `.clear` to reset variables and restore app
bindings, and `.exit` or Ctrl+D to quit. The CLI awaits `App.close()` afterwards,
including when model loading or terminal input fails. This is a terminal JavaScript
REPL. It uses the app's configured services and database, so commands have the
same effects as server code.

Development tools can reuse `runRepl({ values, input, output })` from
`@db3.ai/app/cli`; the caller owns app startup and shutdown. `runDb3()` accepts
`input` and `output` streams for its interactive command in addition to the
existing line-output adapters.

The migration-generation npm script type-checks the app before invoking
`db3 db:make-migration`. The direct command uses runtime model validation;
it does not run the application's TypeScript checker. Review generated source
before applying it. `db:check` returns a nonzero exit status for drift, pending
migrations or missing migration files. Unsafe generation remains blocked by
the database service, and source generation is refused in production.

## Register service commands

The starter keeps this configuration under `server/cli.config.ts`:

```ts
import type { CliConfig } from '@db3.ai/app/cli';
import { databaseCommands } from '@db3.ai/app/db/commands';
import { appsCommands } from '@db3.ai/app/apps/commands';
import { createApplication } from './app';
import { readConfig } from './config';

export default {
	/** Creates the app without starting an HTTP listener. */
	createApp: () => createApplication(readConfig()),
	/** Prepares installed nested apps for operational commands. */
	prepareApp: application => application.apps.boot(),
	commands: [...databaseCommands, ...appsCommands],
} satisfies CliConfig;
```

The loader also accepts `server/cli.config.mjs` or `.js`, checking `.ts` first.
Run from the app root. Registration modules should declare factories and
commands without opening connections or starting listeners at import time.
Help and usage errors do not call `createApp`. Actions registered with
`defineCommand()` run after the app is created, so they can use `app()` and
ActiveRecord normally. The runner awaits
`App.close()` after success or failure. App subclasses must close any additional
resources they own.

`repl` is registered by the framework and requires an app factory.
`queue:make-job` is registered by the framework and works without an app configuration.
Queue worker/dispatch/retry and scheduler worker/run/list/history commands are
registered by the framework too; applications configure their policy rather than
redeclare them. Database and Apps commands remain explicitly registered. Duplicate command names fail
instead of silently overriding another service. The interactive REPL keeps its
invocation open until session exit. Long-running commands declare `execution: 'worker'` and cooperate with
`context.signal`; their service owns draining and the CLI awaits it.
`CliOptions.signal` also permits cancellation by an embedding caller.
`context.prepareApp()` shares one operational preparation promise, while
`context.app()` only creates the host.

## Service, command and action

Commands use `service:action` names, with one action function per file and a
small registration index inside the service:

```text
db/commands/
	migrate.ts
	check.ts
	makeMigration.ts
	index.ts
```

For example, the `migrate.ts` action calls `app().db.migrations.migrate()` and
returns its normal result. It does not print output or decide process exit
codes. `DatabaseOptions.migrations` supplies the app's model registry and policy.
Migration files and the schema snapshot use the framework's fixed
`server/database/` paths relative to `app().directory`; no separate migration
configuration file is needed.

The service index imports its actions and registers them through `defineCommand()`:

```ts
import { defineCommand } from '@db3.ai/app/cli';
import makeMigration from './makeMigration';

export const databaseCommands = [defineCommand({
	name: 'db:make-migration',
	description: 'Generate a migration from model changes.',
	parameters: [{ name: 'name' }],
	/** Passes named CLI parameters to the ordinary action function. */
	handle: parameters => makeMigration({ name: parameters.name }),
	exitCode: result => result.blocked ? 1 : 0,
})];
```

Positional values map to declared parameter names; required parameters precede
optional ones. `options` declares string, boolean and numeric long options with
descriptions, required/default values, numeric bounds and repeatable strings.
Handlers read validated values through `context.options`. Both `--name=value`
and `--name value` work; `--` preserves subsequent literal positional values.
Boolean switches accept explicit `=true`/`=false`. Unknown options, duplicate
non-repeatable options, missing values and extra arguments fail before startup.
`aliases` adds invocation names without duplicating handlers or bootstrap.
Use command-specific `--help` to see the same declarations. The
adapter formats results for the terminal and maps domain results to exit codes.
Use `needsApp: false` for operations such as source generation that do not need
an application. `formatResult` can provide a concise terminal message.

Export the action functions and command index through a supported service
subpath. An app registers the index in its `commands` array. This explicit index
makes it clear which files are callable commands. Database actions are exported
from `@db3.ai/app/db/commands`, and Queue actions from `@db3.ai/app/queue/commands`.

A future UI's authenticated server handler can call the same action, such as
`migrate()`, within its existing app context and receive a normal result. Command
registration does not expose an HTTP endpoint or grant permission to execute it.
Validation and business rules remain in the underlying service operation.

For embedded terminal execution, `new Cli(config, options).run(args)` returns
an exit status and accepts output adapters. The lower-level `CliCommand` contract
also supports custom adapters that manage their own parameter mapping.
Run one app-backed command at a time within a process, matching the framework's
process-global active application. An already running app should call the
underlying service operation directly rather than create a second app via CLI.

## Verification

```sh
npm run test:service --workspace @db3.ai/app -- cli
```

Runner tests cover help, validation, duplicate registration, lazy startup,
failure cleanup and the real executable's TypeScript configuration loading.
Database command tests live under the DB service and use disposable MariaDB
databases. Release verification installs the packed framework into a generated
app, then generates, applies and checks actual migrations through `db3`.

## Visual command discovery

`listDb3Commands({ directory })` returns serializable `CliCommandInfo` records
for the same built-in and app-registered commands as `runDb3`. Each record has
`name`, `aliases`, `description`, ordered `arguments`, declared `options`,
`execution`, and `interactive`. Discovery imports
registration without calling `createApp`, validates duplicate/invalid definitions,
and releases its scoped TypeScript loader. Invalid configuration rejects the
promise. `new Cli(config).commands()` exposes the same metadata for an already
registered runner, with detached argument declarations.

Use `execution: 'interactive'` (or `interactive: true`) for terminal input and
`execution: 'worker'` for long-running processing. Discovery marks both kinds
`interactive: true` to keep existing one-shot visual runners from launching them. The built-in REPL does this. Visual one-shot runners must exclude these
commands from execution. Registration and discovery do not grant HTTP access.

The separate `@db3.ai/dev` panel uses discovery for its Commands tab and runs the
ordinary CLI in isolated local processes. It captures the same output and exit
status without adding endpoints to consuming applications. Structured service
results remain available by calling the underlying action directly.

`db3 list --json` writes `{ formatVersion: 1, commands }` with this catalogue,
without creating an app or reading its database. This command catalogue is the
current inspection surface; the broader application graph and visual manager are
separate work. Application command namespaces may retain nested app IDs with
underscores. This does not yet add automatic nested command/agent contributions.
