# Framework release policy

## Current status

The repository can build and test release-shaped `@db3.ai/pure` and
`@db3.ai/app` tarballs, but it must not publish them yet. Publication is blocked
until the remaining external and release decisions are complete. The framework
uses MIT, with a root licence scope that explicitly excludes private application
code and unrelated packages. Root, App, Pure and Create metadata declare MIT; this is
not permission to publish the current private monorepo or its history.

1. `db3ai/framework` is the dedicated public source repository. Its initial source
   push contains App, Pure, Create, tests, service documentation and examples.
   This source publication is not a stable release or npm publication.
   The private Platform and Scout monorepo is not the npm publication source.
2. The package `repository` objects target `db3ai/framework`, with the
   correct package directories. Verify the remote
   exists and contains the reviewed source before publication.
3. Confirm the project team can publish public packages in the `@db3.ai` npm
   scope. A missing registry package does not prove publish permission.
4. Complete the first-publication bootstrap described below, then configure npm
   trusted publishing for each package.
5. Create GitHub tag protection and the protected `npm-production` environment.

The checked-in `framework-release-candidate.yml` workflow cannot publish. It has
read-only repository permission, no npm token, no OIDC permission, and no npm
publish or stage command. It deliberately fails when run from a private
repository.

`framework-ci.yml` runs read-only source/example checks, all three workspace
test suites with required MariaDB/Redis, the packed App/Pure consumer gate and
release-policy tests on public `main` and maintenance-branch pushes/PRs. It has
no publishing credentials or write permission. This is not the complete starter
release gate: generated-app integration, dependency review, coverage floors,
release-branch validation and package provenance retain their separate checks.

## Public repository shape

### Creator preview, not yet in the release lane

`packages/create` now packs as `@db3.ai/create`. Its generated app uses the
matching `@db3.ai/app` release and offers password login, private notes and
optional server-side BYOK AI. See `packages/create/README.md` for the three-tarball
consumer trial. The intended public entry point is `npm create @db3.ai@latest`.

The source exporter now includes Create's reviewed source, template, safety tests
and licence. Its source manifest remains private; template App version and
non-workspace dependencies are validated during export. The release-candidate
packaging workflow still handles only App and Pure. Before releasing Create,
add its staging/version checks, verify its packed generated-app journey in CI,
and establish its own npm publication/provenance access.
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
	private monorepo, Scout and existing Git history outside the public repository.
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

### Branches, immutable releases and versioned documentation

The intended workflow is a development branch plus maintained release branches
and immutable tags. This follows the distinction in Laravel's
[contribution guide](https://laravel.com/framework/docs/13.x/contributions#which-branch):
upcoming breaking changes have their own branch, while fixes and compatible
changes target a maintained version. Laravel calls its upcoming branch `master`;
DB3 will use `main`.

| Source | Purpose | Public install/docs behavior |
| --- | --- | --- |
| `main` | Upcoming development; may change APIs, but checks should stay green | Clearly labelled Upcoming docs. Merging does not publish to npm. |
| `0.1.x` initially, then `1.x`, `2.x` as needed | Maintained release line; fixes and compatible changes only | Released versions in that line, never untagged branch HEAD |
| `framework-v0.1.0`, `framework-v1.0.1`, etc. | Immutable, annotated release identity | Exact matching npm versions and documentation artifacts |
| `framework-v0.1.0-beta.1`, etc. | Explicitly reviewed prerelease | npm `next`, never automatic promotion to `latest` |

These names describe the target policy; this document does not create branches,
tags or packages. Before 1.0, use a minor release line such as `0.1.x` so a
breaking `0.2.0` cannot silently change the documentation for `0.1` users.
After 1.0, use normal major-version compatibility and release lines. Begin with
one supported line rather than committing to an unstaffed multi-version support
schedule. Do not create `1.x` until there is a 1.x release to maintain.

When a release line is cut, `main` continues toward the next release. Land fixes
on the oldest affected supported line, then forward-port applicable fixes and
tests to newer lines and `main`. Never move a published tag. A corrected package
gets a new version; documentation-only corrections get a new, traceable docs
revision tested against the same released packages.

**Release gate change still required:** the current context script requires a
release tag's commit to be an ancestor of the default branch. That would reject
a legitimate maintenance release not yet merged forward. Before this workflow
is enabled, validate stable releases against the protected, version-matching
release branch instead. Explicit prereleases may use protected `main` or their
matching release branch, and must use `next`. Retain the annotated-tag,
exact-commit, repository, version, changelog and package-integrity checks. Test
rejection of mismatched branches/tags and stable releases from `main` once a
release line exists. Do not simply remove the ancestry check.

#### Website in the framework repository

The target public repository contains the framework packages, Create, tested
examples and the documentation website. Keep the website as its own application
workspace, not part of the App npm package. A feature, its guide and its example
test can then change in one pull request and be reviewed together. Scout remains
private and consumes released framework packages.

The website is not in the current public export. First remove private filesystem
and deployment assumptions, make DOM Studio installation portable with reviewed
licensing, and prove a clean-clone website build. Hosting credentials and private
operations remain outside public source. This move must not expose existing
private repository history and need not delay the initial package preview.

#### Version selector and source of truth

- Add versioned routes such as `/docs/0.1/active-record`, later `/docs/1.x/active-record`,
	and `/docs/main/active-record`. Existing unversioned links resolve to the current
	default released line; before any release, visibly identify the preview.
- Populate the dropdown from a reviewed build manifest of real published docs
	artifacts: current stable, supported older lines and Upcoming. Never advertise
	a version merely because a branch or package version string exists.
- Build released guides, examples, API declarations, search and Markdown/AI feeds
	from the same tagged source and exact package set. A stable line points to its
	latest published compatible release; display the exact package version and
	docs revision. Annotate APIs introduced after the first release in that line.
- Keep immutable release artifacts for reproducibility. A docs-only correction
	must keep the package version fixed and record its own commit; regenerating
	old API references from `main` is forbidden.
- Changing the dropdown preserves the current article and section when present.
	If the page does not exist in that version, say so and offer that version's
	index. Never silently show the upcoming API under a stable-version heading.
- Keep internal links, canonical URLs, search results and AI feeds within the
	selected version. Mark Upcoming visibly as subject to change. Verify switching,
	direct links, missing pages and old-package examples with integration tests.

The current header displays one package version; it is not yet a version
selector. Release snapshots, version routing and this dropdown are separate
implementation work, not functionality enabled by this policy update.

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
docs/framework-conventions.md
docs/framework-goals.md
docs/framework-release.md
docs/service-module-migration-plan.md
packages/app/
packages/pure/
packages/create/
scripts/check-framework-release-context.mjs
scripts/lib/framework-release-policy.mjs
scripts/prepare-framework-release.mjs
scripts/stage-framework-packages.mjs
scripts/tests/framework-package-consumer.test.mjs
scripts/tests/framework-release-policy.test.mjs
```

The exporter also carries reviewed `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
`NOTICE`, `SECURITY.md`, or `SUPPORT.md` files when they exist. The public
repository may contain additional framework documentation and tools, but it
must not require Scout source or configuration. App's package-owned test
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
`README.md`, `bin/`, `package.json`, `src/`, `template/`, and `tests/`.
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
The current source exporter intentionally excludes all application workspaces.

Keep Scout in a private repository. A multi-root editor workspace can open
Scout and the framework side by side; an ignored local application checkout is
another option once CI and deployment paths support it. Released Scout builds
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

`npm stage publish` cannot create a brand-new package, and both target package
records are currently absent. Therefore the first public version needs a
separately reviewed bootstrap decision; the normal stage-only workflow cannot be
enabled first.

If provenance is required on version `0.1.0`, the safest practical bootstrap is
a one-time workflow in the public repository that uses a short-lived,
least-privilege npm credential stored only in the protected `npm-production`
environment. It must run the same candidate gates, use `npm publish
--provenance` for Pure and only then App, and require environment approval. After
the first version exists, immediately remove the credential and bootstrap
workflow, configure both stage-only trusted publishers, and disallow token
publishing. This exception must be explicitly approved before implementation.

For every later version, automation should run `npm stage publish` for Pure and
then App. A maintainer downloads and reviews both staged tarballs, checks them
against the candidate integrity record, approves Pure first with 2FA, and only
then approves App. npm documents the manual approval flow in
[staged publishing](https://docs.npmjs.com/staged-publishing/).

No executable publication workflow belongs in the repository until the license,
public source location, npm access, bootstrap, environment, and protected-tag
decisions above are complete.
