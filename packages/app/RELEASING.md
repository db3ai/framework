# Framework release policy

## Current status

The registry contains the initial `0.1.0-beta.1` preview of `@db3.ai/pure`,
`@db3.ai/app` and `@db3.ai/create` (verified on 2026-09-27). Prepare subsequent
previews through the manual beta publication procedure below, after release
verification and explicit maintainer authorization. Publish prereleases under
`next`; changing `latest` is a separate promotion. The automated candidate
workflow remains non-publishing until its external protection and trusted
publisher requirements are satisfied. The strict
packed-package consumer now passes with dependency declaration
checking enabled. The pinned Agents SDK has a type-only Node shim shipped by
App; it must be reviewed or removed when upgrading the SDK. The framework
uses MIT, with a root licence scope that explicitly excludes private application
code and unrelated packages. Root, App, Pure and Create metadata declare MIT; this is
not permission to publish the current private monorepo or its history.

1. `db3ai/framework` is the dedicated public source repository. Its initial source
   push contains App, Pure, Create, tests, service documentation and examples.
   Source publication is distinct from npm publication or a stable release.
   The application development monorepo is not the npm publication source.
2. The package `repository` objects target `db3ai/framework`, with the
   correct package directories. Verify the remote
   exists and contains the reviewed source before publication.
3. Verify the current maintainer's authenticated npm publication access before
   publishing. Existing packages do not prove the current session has access.
4. Configure npm trusted publishing for each package after the initial bootstrap.
5. Create GitHub tag protection and the protected `npm-production` environment.

The checked-in `framework-release-candidate.yml` workflow cannot publish. It has
read-only repository permission, no npm token, no OIDC permission, and no npm
publish or stage command. It deliberately fails when run from a private
repository.

`framework-ci.yml` runs read-only source/example checks, all three workspace
test suites with required MariaDB/Redis, App's coverage floors, the packed
App/Pure consumer gate, the packed generated-app gate and release-policy tests
on public `main` and maintenance-branch pushes/PRs. When the repository has the
`CODACY_API_TOKEN` Actions secret, the workflow uploads App's LCOV report to the
`db3ai/framework` Codacy project. It has no publishing credentials or write
permission. Dependency review, release-branch validation and package provenance
retain their separate checks.

## Public repository shape

### Creator preview in the release lane

`apps/starter` is the canonical runnable starter and framework feature playground.
It is a private application workspace in the public source repository. Develop
it against the local framework with `npm run dev:starter`; its package README
documents database setup. The creator copies this source directly in a checkout.
Package staging includes a clean copy under Create's `template/` directory, so
there is no separately maintained template. The shared source selector excludes
local environments, installs, builds and runtime artifacts and rejects symlinks.
CI checks both the workspace app and its independent generated package consumer.

`packages/create` now packs as `@db3.ai/create`. Its generated app uses the
matching `@db3.ai/app` release and offers password login, private notes and
optional server-side BYOK AI. See `packages/create/README.md` for the three-tarball
consumer trial. The intended public entry point is `npm create @db3.ai@latest`.

The source exporter now includes Create's reviewed source, the starter workspace, safety tests
and licence. Its source manifest remains private; template App version and
non-workspace dependencies are validated during export. The release-candidate
packaging workflow stages Pure, App and Create in dependency order. It checks
lockstep template versions and runs a packed generated-app consumer through
installation, migrations, Auth, notes, simulated AI, agent tools, history, queued
runs, images, embeddings and TypeScript compilation. Establish Create’s own npm
publication/provenance access before publishing.
Do not bypass the private-source boundary by publishing directly from this
monorepo. Confirm DOM Studio redistribution terms before distributing the public
starter. A successful local pack/build is not public publication or production
approval. The starter's production-hardening TODOs remain explicit in its README.

### First public preview acceptance

Test tarballs before publishing: they prove the package file boundary, public
imports, type declarations and generated application without relying on workspace
links. Publishing is still useful for a different final check: the actual public
registry command and its transitive dependency resolution.

The proposed first release is an explicitly labelled preview, not the default
stable release:

1. Complete Create's release checks above. Keep the
	private applications and existing Git history outside the public repository.
2. Run the public repository's clean-install checks with real MariaDB and Redis,
	including a generated app's migration, login, note CRUD, simulated AI, tests
	and build. Close blocking dependency/security findings before publication.
3. Publish matching prerelease versions in dependency order: Pure, App, Create.
	The generated template must pin the matching App prerelease, not an unavailable
	stable version. Use the `next` distribution tag, leaving `latest` unchanged.
4. From a directory outside the monorepo, run the command below using npm only.
	Do not substitute local tarballs, workspace links or cached private source.
	Follow the published native MariaDB setup and separately test the Docker path.
5. Verify configuration, migrations, register/login, owned notes, optional AI,
	tests, production build/start and a small feature change. Promote a stable
	release to `latest` only after its own gates pass and promotion is authorized.

After that preview has actually been published, the command will be:

```sh
npm create @db3.ai@next my-app
```

npm maps the scoped `create` initializer to `@db3.ai/create`; distribution tags
select the intended release. See [npm init](https://docs.npmjs.com/cli/v11/commands/npm-init/)
and [distribution tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/).
Neither a public repository nor an npm package guarantees inclusion in future
AI training. Crawlable, versioned documentation and runnable examples also serve
developers and retrieval-based tools independently of model training.

This is a release proposal, not publication authorization or evidence that the
registry command is currently available.

### App/Pure/Create source export

Move the framework into a fresh public source repository rather than exposing
the existing monorepo or its history. Preserve this minimal layout so the test
and release seams remain portable:

```text
.github/workflows/framework-ci.yml
.github/workflows/framework-release-candidate.yml
.gitignore
AGENTS.md
CHANGELOG.md
LICENSE
README.md
package.json
package-lock.json
tsconfig.base.json
packages/app/CONVENTIONS.md
packages/app/RELEASING.md

packages/app/
packages/pure/
packages/create/
apps/starter/
scripts/check-framework-release-context.mjs
scripts/lib/framework-release-policy.mjs
scripts/prepare-framework-release.mjs
scripts/stage-framework-packages.mjs
scripts/tests/framework-package-consumer.test.mjs
scripts/tests/framework-release-policy.test.mjs
```

The public root includes `packages/*` and explicitly `apps/starter`; no other
application workspace is exported. The starter is MIT licensed under the root
licence scope, while its third-party dependencies retain their own terms.

The exporter also carries reviewed `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
`NOTICE`, `SECURITY.md`, or `SUPPORT.md` files when they exist. The public
repository may contain additional framework documentation and tools, but it
must not require another application's source or configuration. App's package-owned test
environment optionally reads `packages/app/.env.test` and otherwise uses CI
environment variables. Release tests always force the `db3_app_test` database
namespace and require real MariaDB and Redis services.

Ordinary local staging omits the private monorepo repository metadata. The
release-preparation command first requires both checked-in manifests to contain
the requested version and canonical public `repository.url`, because npm
compares that URL with the trusted GitHub source. It then propagates the same URL
into the staged manifests and rejects stale, ambiguous, or non-GitHub metadata.

## Public source export

Audit the exact public-source allowlist before creating any output:

Use Node.js 24 with npm 11 or newer for the source export. The local export
passed with Node 24.15.0/npm 11.12.1; npm 10.9.4 failed while generating the
workspace lockfile. This is a development-toolchain requirement, not verification
of every Node version allowed by the runtime packages' engine declarations.

```sh
npm run framework:export:public -- --repository db3ai/framework --preflight
```

The App allowlist is `.env.test.example`, `README.md`,
`agent-instructions.md`, `bin/`, `package.json`, `scripts/`, `src/`,
`templates/`, `tsconfig.examples.json`, `tsconfig.json`, and
`vitest.config.ts`. The Pure allowlist is `README.md`, `examples/`, `package.json`, `src/`,
`tests/`, `tsconfig.json`, and `vitest.config.ts`. Create's allowlist is `LICENSE`,
`README.md`, `bin/`, `package.json`, `src/`, and `tests/`.
The starter exports its reviewed configuration, README, source, migrations,
scripts and tests using the creator's shared file selector.
The exporter also includes
only the reviewed root metadata, framework documentation, release policy
scripts/tests, and the non-publishing check/candidate workflows described above.

After preflight passes, create the validated source tree with the same explicit
repository identity:

```sh
npm run framework:export:public -- --repository db3ai/framework
```

Pass `--output dist/public-framework` to make the default destination explicit
or to select another safe path below `dist`. The exporter does not initialize a
Git repository, create or contact a remote, push source, or publish packages.
Both preflight and export require the reviewed root `LICENSE` and its matching
SPDX identifier. Those licence prerequisites are now present; content and
consumer validation remain independent gates.

## Keep the local workspace practical

The destination is an organisation-owned public framework monorepo:
`db3ai/framework`. Steve has confirmed ownership of the `db3ai` GitHub
organisation and the `db3.ai` npm organisation. These are separate account
names: GitHub uses `db3ai`, while package imports use the `@db3.ai` scope.
The first source push starts a fresh `main` history; it carries no private
monorepo commits. Authenticated npm publication access remains unverified.
Keep `packages/app`, `packages/pure` and `packages/create` together. The website can join it once
its DOM Studio dependency and deployment files are independently portable.
The current source exporter includes only the `apps/starter` application workspace.

Keep private applications in separate repositories. A multi-root editor workspace can open
an application and the framework side by side; an ignored local application checkout is
another option once CI and deployment paths support it. Released application builds
should consume locked framework packages. Local source links can help during
development but do not replace packed-consumer release checks.

Do not change the visibility of the current Platform repository. Export a
reviewed source-only tree into a fresh repository so private product code,
credentials and historical files never become public through Git history.

## Candidate process

Pure and App use lockstep SemVer. App must depend on the exact matching Pure
version, and every release uses one root changelog entry and one annotated tag:

```text
CHANGELOG heading: ## [1.2.3] - 2026-08-20
Git tag:            framework-v1.2.3
Confirmation:       prepare framework-v1.2.3
```

Before tagging, move the relevant items from `Unreleased` into the dated version
section, set both versions, and set App's Pure dependency to the exact version.
Candidate preparation validates these reviewed values; workflow input never
silently rewrites a package version.
Merge the reviewed change into the public repository's protected default branch,
then create a protected annotated `framework-vX.Y.Z` tag at that commit.

Dispatch `Framework release candidate` from that exact tag and enter the version
and confirmation. The workflow:

1. rejects non-manual events, a private repository, a branch or mismatched tag,
   a lightweight tag, a tag whose commit is not on the default branch, and an
   incorrect confirmation;
2. installs only the Pure and App workspaces without running dependency install
   scripts or using a package cache;
3. rejects high-severity production dependency advisories;
4. type-checks and tests Pure, then runs App's complete coverage release suite
   against digest-pinned MariaDB and Redis images;
5. runs the release-policy tests and clean temporary-consumer install gate;
6. validates identity, versions, repository metadata, license, changelog,
   dependency order, and package allowlists;
7. runs `npm pack --dry-run --json` for Pure and then App before producing the
   candidate tarballs; and
8. uploads the tarballs plus `release-candidate.json` integrity evidence for
   seven days.

The equivalent local inspection command is:

```sh
npm run framework:release:prepare -- \
	--version 1.2.3 \
	--repository db3ai/framework
```

This command only writes under `dist/framework-release`; it never contacts npm
to publish or stage a package. In this private monorepo it is expected to fail
until the public source and versioned changelog requirements are satisfied.
The MIT licence and intended package repository metadata are already present.

## Trusted publishing and provenance

Do not add a long-lived npm token to the normal release workflow. Once each npm
package exists, configure one trusted GitHub publisher per package with:

- the dedicated public repository owner and name;
- the exact future publication workflow filename `framework-publish.yml`;
- environment `npm-production`; and
- `npm stage publish` permission only, not direct `npm publish`.

The future publication job must run on a GitHub-hosted runner, set only
`contents: read` and `id-token: write`, use Node 24 with npm 11.15 or newer,
disable package-manager caching, and pin every third-party Action to a complete
commit SHA. Configure each npm package to require 2FA and disallow traditional
publish tokens after trusted publishing is active.

With npm 11.15 or newer, configure both stage-only relationships after the
bootstrap release while authenticated as a package maintainer:

```sh
npm trust github @db3.ai/pure --repo db3ai/framework \
	--file framework-publish.yml --env npm-production --allow-stage-publish
npm trust github @db3.ai/app --repo db3ai/framework \
	--file framework-publish.yml --env npm-production --allow-stage-publish
```

GitHub's `npm-production` environment should require at least one reviewer,
prevent the workflow initiator from approving their own run, and allow only
protected `framework-v*` tags. Protect tag creation separately so an ordinary
writer cannot manufacture a release ref. Environment protection availability
depends on the public repository's GitHub plan and must be verified in repository
settings before a publication workflow is enabled.

npm trusted publishing automatically generates provenance only for public
packages built from a public source repository. That is why this candidate gate
rejects the private monorepo and requires exact package repository metadata.
See npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[provenance](https://docs.npmjs.com/generating-provenance-statements/)
documentation, plus GitHub's guidance for
[deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
and [pinning Actions to full commit SHAs](https://docs.github.com/en/actions/reference/security/secure-use).

## First-publication bootstrap

`npm stage publish` cannot create a brand-new package. Therefore a first public version needs a
separately reviewed bootstrap decision; the normal stage-only workflow cannot be
enabled first.

### Manual beta publication

A maintainer can publish directly from the repository root using Node.js 24 and
npm 11. Log in to npm, complete the release tests and dependency audit, then run:

```sh
npm run framework:publish -- --version 0.1.0-beta.1
```

Add `--dry-run` to build and inspect the same packages without publishing:

```sh
npm run framework:publish -- --version 0.1.0-beta.1 --dry-run
```

The command compiles Pure and App, copies the canonical starter into Create,
applies the selected version and exact framework dependency pins to disposable
package manifests, and inspects every package before publishing. It then runs
ordinary `npm publish` from each built package directory in Pure, App, Create
order. npm creates and uploads the archives itself. No tarball management is
required. Workspace versions and source exports remain unchanged.

The version is required. Prereleases default to `next`; stable versions default
to `latest`. `--tag` can select another channel. Authentication stays in npm's
interactive terminal, and a failure stops subsequent publications. For a partial
release, check npm's registry before continuing; published versions cannot be
overwritten. If Pure succeeded but App failed, keep the same source and version
and resume with `--from app`; use `--from create` when only Create remains.
This command builds the current checkout, so rerun the relevant
release verification when source changes. It does not rerun the full test suite.

The private monorepo root is not an npm package to publish. Bare `npm publish`
there cannot publish all three framework packages. Their workspace manifests
also target TypeScript source; staging supplies the compiled public exports.

Inspected tarballs remain an optional way to freeze verified release artifacts.
Both publication routes use `--access public` and `--provenance=false`. The explicit
provenance override is required for a workstation publication: it does not have
the CI identity needed to generate an npm provenance attestation. Do not claim
CI provenance for this release or fabricate a CI environment. Publishing the
packages remains a maintainer action; preparing the handoff never publishes.

Keep the corresponding reviewed source available in `db3ai/framework`. After
the first publication, configure trusted publishing for all three packages for
subsequent releases. A manual beta does not change the provenance and protected
context requirements of the automated candidate workflow.

### CI bootstrap with provenance

If provenance is required on version `0.1.0`, the safest practical bootstrap is
a one-time workflow in the public repository that uses a short-lived,
least-privilege npm credential stored only in the protected `npm-production`
environment. It must run the same candidate gates, use `npm publish
--provenance` for Pure, App and Create in that order, and require environment approval. After
the first version exists, immediately remove the credential and bootstrap
workflow, configure all three stage-only trusted publishers, and disallow token
publishing. This exception must be explicitly approved before implementation.

For every later version, automation should run `npm stage publish` for Pure and
then App. A maintainer downloads and reviews both staged tarballs, checks them
against the candidate integrity record, approves Pure first with 2FA, and only
then approves App. npm documents the manual approval flow in
[staged publishing](https://docs.npmjs.com/staged-publishing/).

No executable publication workflow belongs in the repository until the license,
public source location, npm access, bootstrap, environment, and protected-tag
decisions above are complete.
