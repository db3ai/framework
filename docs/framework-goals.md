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
