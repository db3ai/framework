# DB3 Framework Product Goals

## Developer Experience Led By Documentation And Demos

The website is part of the framework's product design, not just a description
of its existing implementation. Each section should begin with a practical
developer task and a proposed clear walkthrough, then use that walkthrough to
identify and improve friction in the framework itself.

Review public API discoverability, naming, setup, defaults, repeated wiring,
errors, testing, authorization and production operation. If a common task needs
unnecessary application glue, manual field conversion, private imports or
unexplained setup, assess a focused framework improvement rather than merely
writing a longer explanation of the workaround. Fewer lines of code are not a
win if they hide permissions, cost, failure behaviour or lifecycle ownership.

The delivery unit is a coherent developer workflow: the framework capability,
an executable consumer example, useful error/recovery paths, and the rendered
guide/demo. A section is complete only when that experience has been reviewed,
not merely when its API reference and source links are accurate.

Draft future workflows as explicitly unpublished design proposals. Published
documentation and demos must describe implemented, tested public APIs for the
stated package version. Use real consumer attempts and observed friction to
judge improvements; do not claim the best experience from a code review alone.

## Starter And Optional Example Apps

The starter is the foundation for a real application: a polished authentication
experience, account settings, an admin shell and normal feature-app integration.
Developers should be able to copy it and start building without first removing
demonstration models, pages and jobs.

Keep runnable demonstrations in an optional examples collection using feature
apps. Each example owns its UI, server behaviour, models, migrations and tests,
while sharing the host's authentication and framework services. Tutorials teach
the public API directly and link to these apps as complete runnable examples.
Examples should be available for local demos but excluded from newly generated
projects by default. Service-owned library examples remain useful for focused
package and documentation verification.

Use flat, prefixed folders: `apps/example_model_sync/`, with sibling apps such
as `apps/example_job_progress/`. The folder and canonical app ID are both
`example_model_sync`; the manifest display name is `Example model sync` and
owned tables use the prefix `example_model_sync_`. Use `example_` consistently
for demo apps. Underscores fit the existing identifier rules; hyphens do not.

This uses the current immediate-folder discovery without adding nested app
namespaces. Keep the examples optional and verify creator exclusions when
adding them. Moving existing demos still requires updating their registrations,
owned data and tests; a directory rename alone is not a migration.

## Application Environments And Recovery

Operational knowledge should live in a versioned application profile: source
revision, build recipe, process roles, database, storage, configuration and required
secret names. The optional `@db3.ai/environments` package owns these operations
outside the application runtime. Its CLI and future visual tools share one API.

The first implemented slice captures non-Git state and rebuilds an exact Git
revision into isolated local Docker for a recovery drill. It verifies restored
data and HTTP health, then stops the copy. Remote deployment, persistent previews
and a visual environment manager remain future work. See
[environment recovery](framework-environment-recovery.md) for scope and evidence;
a live-host clone alone does not establish disaster recovery after host loss.

## Core Embeddings And Retrieval

Embeddings are a first-class framework capability for files, explicitly selected
application model fields, and arbitrary text. Applications should be able to
index, search, update and remove these sources through one reusable service,
rather than rebuilding application-specific embedding infrastructure.

The service should own extraction, token-bounded chunks, compatible vector
profiles, source revisions, indexing state, scoped retrieval and source-backed
results. Provider calls use the shared AI service for tracking, usage, costing,
allowance and rate limits. Storage/Media owns original files, DB owns native
vector primitives, and Queue owns durable processing.

Applications retain authorization, client/project relationships, source
selection and permitted data-processing policy. Retrieval must enforce current
access, including cross-project AI access and revocation. An embedding index is
not authority to read a file, proof that its content is correct, or a substitute
for the original source.

The collaborative reference app should demonstrate a project AI grounded in
files, records and text, plus an owner-managed AI working across explicitly
authorized projects. The CLI, visual interface and AI tools should use the same
indexing and retrieval operations.

This is the target capability, not a claim that a generic file ingestion service
already exists. Public APIs, source adapters and compatible-vector tests must be
delivered before the capability is advertised as available.

## Visual Application Development

### Goal

The DB3 framework should provide the foundations expected from a powerful application
framework while making building, understanding, and operating an application a
first-class visual experience.

After installing and configuring the framework, a developer should be able to
open a visual workspace, create an application, and continue building without
needing to understand every terminal command first. The CLI remains a
first-class interface for automation, repeatability, recovery, and experienced
users, but it should not be the only complete way to use the framework.

### Product Note

A growing group of developers begins with collaborative tools such as Codex
rather than with years of terminal experience. The framework should meet those
developers at a visual, inspectable layer without hiding how the application
works or reducing what an experienced developer can do.

Framework capabilities should therefore be designed around reusable service
contracts first. The CLI, visual workspace, programmatic APIs, and AI tools
should call the same underlying operations and receive the same validation,
authorization, results, and errors. The GUI should not reproduce framework
logic, scrape terminal output, or become a second runtime.

A complete visual workspace should eventually make it possible to:

- Create and manage an isolated application after framework setup.
- Define models, fields, relationships, indexes, validation, and permissions.
- Define and inspect actions, jobs, schedules, events, and flows.
- Preview schema and API changes before applying them.
- Inspect routes, requests, responses, queries, logs, exceptions, queue work,
  and application traces.
- Run safe development operations that are also available through the CLI,
  including dispatching or retrying jobs and inspecting framework state.
- Review generated artifacts and source changes as normal versioned project
  changes rather than opaque UI state.
- Connect collaborative AI tools that can explain the application, propose
  changes, generate framework artifacts, and use current telemetry as context.

### Design Principles

- **One authoritative application definition.** Code, configuration, and any
  future declarative definition must not diverge into separate CLI, GUI, and AI
  representations.
- **Shared framework operations.** Important capabilities should have a stable
  service or API contract that can support both command-line and visual clients.
- **Visual parity by design.** A capability may launch through the CLI first,
  but its contract should allow a visual client to expose it without invoking a
  shell command or duplicating its implementation.
- **Round-trip by design.** Authoritative code, configuration, and application
  definitions update their visual representations. Supported visual edits use
  the same framework operations to produce validated, reviewable source,
  configuration, and migration changes. Capabilities that cannot safely make
  that round trip remain explicitly read-only.
- **Safe, reviewable changes.** Schema, API, deployment, and destructive
  operations should provide validation, previews, diffs, and explicit
  confirmation where appropriate.
- **Progressive disclosure.** Common workflows should be approachable without
  terminal knowledge while advanced configuration and source remain available.
- **Application isolation.** The visual control plane may manage applications,
  versions, and developer workflows, while each application runtime keeps its
  own database, storage, queue, cache, secrets, and execution boundary.
- **AI as a collaborator, not a separate source of truth.** AI tools should use
  the same contracts, definitions, documentation, and telemetry as human-facing
  tools, and their proposed changes should remain inspectable and reviewable.

### Current Boundary

This is a product direction, not a claim that the complete visual builder exists
today. It does not restore the removed ad-hoc developer database builder. A
future model or application editor needs an explicit, versioned application
definition, safe migration previews, policy-aware generated APIs, and auditable
changes before it can own schema editing.

The existing development panel is the natural starting point for the visual
workspace. It can grow from requests, queries, logs, and queue inspection into
complete application observability and then expose safe framework operations.
Reusable instrumentation and operations remain owned by `packages/app`; the
panel is a client and control plane for those capabilities.

### First Studio command surface

The standalone development panel now provides an initial Commands workspace:
app selection, registered-command discovery, positional-input forms, incremental
CLI output and bounded run history. It uses shared framework APIs and isolated
local execution; no builder interface or command routes belong in consuming applications.

The longer-term Studio direction is one local application for setup, app and
source exploration, code review, model/relationship inspection and framework
code generation. It should eventually provision and operate a local development
application without requiring terminal use, using the same underlying operations
as a future cloud control plane. Guided environment/database setup, relationship
diagrams and additional generators are future work, not capabilities of the
initial command explorer.

## Local Feature Apps And Visual Structure

Start cohesive features in a host-local apps/ directory, with a root manifest.json
and App.ts service extending AppService. Folder discovery and marked npm dependency
discovery avoid per-feature host registration. Keep the same ownership when a
feature becomes an independent package. Public services are available through
app().social, with reserved framework names and generated optional types.

The Apps service separates code presence, installation and runtime readiness.
Starter supplies visual exploration, navigation and single-process administrator
installation controls. Apps own migrations and down functions; uninstall retains
data. Visual definition editing, live replacement of loaded code and per-tenant
installation remain future work.
