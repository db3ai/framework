# Changelog

Notable changes to the public DB3 framework packages will be recorded here.
Pure, App and Create use one lockstep version and one release entry.

## [Unreleased]

## [0.1.0-beta.2] - 2026-09-27

- Add discoverable feature apps with app-owned services, routes, migrations,
	CLI lifecycle commands, navigation contributions and a starter administration UI.
- Add WebSocket channels, shared state, presence and authenticated inbox
	invalidation, with runnable collaboration examples in the starter.
- Harden outbound URL access, password authentication, public error responses,
	transaction-aware inbox updates and scheduler recovery.
- Expand framework guides and executable examples, including public-import and
	generated-application release checks.
- Keep the optional local Electron experiment outside generated web applications.

- Resolve app migrations and the schema snapshot by convention under
	`server/database/`. Keep only the model registry in app migration configuration
	and remove the starter's `migrations.ts` settings file. Capture `App.directory`
	once so lazy services and transactions retain the correct app root.
- Add a shared `db3` CLI runner with service-owned commands, lazy app startup,
	help, argument validation and cleanup. Register starter database commands in
	`server/cli.config.ts` and remove its app-owned CLI executable.
- Use `service:action` commands with one action file per command, explicit service
	indexes, named parameters and app context. Expose `app().db.migrations` and
	direct database actions for command-line and application callers.
- Make `apps/starter` the runnable framework playground and sole source for the
	app creator, with clean template packaging, public workspace export and checks
	for both workspace and standalone generated applications.
- Use sibling `client/` and `server/` directories in the starter and generated
	apps, with migrations and schema snapshots under `server/database/`, establishing
	the default layout for new framework applications.

- Use the public `@db3.ai/app` and `@db3.ai/pure` names in development workspaces,
  examples and tests; preserve those imports through packaging and documentation.
- Replace the text-only AI client with the app-level `Ai` service and `Agent`
  classes: function calls, streaming, persisted conversations, images,
  embeddings, structured output, request tracking, usage and provider failover.
- Ship extensible ActiveRecord conversation, message, request and rate-limit
  models. Calls made inside agent tools retain their parent request.
- Add `db3 queue:make-job` and a shared job-scaffolding operation for editor integrations.
- Include Create in package staging and validate its generated application
  against the installed tarballs, including the AI examples and job template.
- Preserve application context types in shared agent tool helpers and ship the
  pinned SDK's Node declaration compatibility with strict consumer verification.

- Declare the TypeScript migration-test loader as an App development dependency
  so clean framework checkouts do not rely on a parent workspace's installation.

This is a preview release with evolving APIs. Follow the release verification
and publication requirements in `docs/framework-release.md`.
