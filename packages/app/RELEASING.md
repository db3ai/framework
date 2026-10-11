# Framework release policy

## Current release process

Publishing a GitHub release in `db3ai/framework` runs
`.github/workflows/framework-publish.yml`. It tests the tagged source before
publishing `@db3.ai/pure`, `@db3.ai/app` and `@db3.ai/create`, in that order,
using npm trusted publishing and provenance. No npm token, interactive login,
or per-release publishing approval is needed in Actions.

1. Commit the changes and a dated `CHANGELOG.md` heading for the new SemVer.
2. Push the reviewed commit to `main` for a prerelease, or its matching
   maintenance branch (`0.1.x`, `1.x`, etc.) for a stable release.
3. Create and push an **annotated** tag, for example:

```sh
git tag -a framework-v0.1.0-beta.5 -m 'Framework 0.1.0-beta.5'
git push origin framework-v0.1.0-beta.5
```

4. Create a GitHub release using that existing tag. Mark versions containing
   `-` as prereleases. Publishing the release starts verification and publication.
   Draft releases do not publish. Creating a new tag through the release UI
   alone does not satisfy the annotated-tag requirement.
5. Check the **Publish framework** run. Success means all three public archives
   were downloaded and their SHA-512 integrity verified. Prereleases use `next`;
   stable releases use `latest`. A published GitHub release alone is not evidence
   that npm publication succeeded.

The verification job runs source/example checks, Pure/Create/Starter tests,
App coverage with required MariaDB and Redis, packed consumers, generated-app
checks, release policy tests, and inspection of the exact versioned artifacts.
Only the subsequent publication job receives `id-token: write` and the
`npm-production` environment. It rebuilds from the verified immutable commit.
Both jobs use Node 24, pinned npm 11.15.0 and Actions pinned to full commit SHAs.
GitHub-hosted Actions capacity must be available; npm does not independently
watch GitHub releases when Actions cannot run.

Workspace manifests intentionally retain development versions. The publishing
script assigns the release version and exact internal dependency pins to
**disposable compiled package manifests**, including Create's starter template.
Do not publish the root or source workspace directories with bare `npm publish`.

Manual dispatch of **Publish framework** accepts an existing annotated tag and
runs verification only. The older **Framework release candidate** workflow also
remains non-publishing and retains its stricter source-manifest version policy;
it is not required by the automatic publication workflow.

### Recovery

All releases are serialized. Re-run failed jobs only for the same immutable tag.
`--skip-existing` skips a previously uploaded version only when its registry
integrity exactly matches the rebuilt artifact; mismatches stop publication.
Never move a published tag or overwrite a version. Source corrections require a
new version. Registry propagation can take several minutes; the final check
waits up to 15 minutes for all archives without uploading them again.

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

## Legacy candidate inspection process

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

## Trusted publishing configuration

Configure each of the three existing npm packages once as a package maintainer:

```sh
npm trust github @db3.ai/pure --repo db3ai/framework \
	--file framework-publish.yml --env npm-production --allow-publish
npm trust github @db3.ai/app --repo db3ai/framework \
	--file framework-publish.yml --env npm-production --allow-publish
npm trust github @db3.ai/create --repo db3ai/framework \
	--file framework-publish.yml --env npm-production --allow-publish
```

Use npm 12.2.0 for this setup. npm may require one-time maintainer authentication
to change trust configuration. Direct publishing permission is intentional:
stage-only permission would still require manual approval on every release.
The GitHub environment `npm-production` permits `framework-v*` tags, with no
required reviewers, so publishing a release is the maintainer's release action.
The workflow additionally checks public repository identity, annotated tag,
exact event/checkout commit, branch ancestry, changelog and package contents.

Only GitHub-hosted publication jobs in that exact repository, workflow and
environment receive short-lived OIDC credentials. No npm token belongs in the
workflow. Newly created trust must complete a successful publish within npm's
initial two-day activation window. Verify each package's configuration and the
first successful publication rather than assuming that saving the workflow
configured npm.

See npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[trust CLI](https://docs.npmjs.com/cli/v12/commands/npm-trust/) documentation.

## Manual fallback

When GitHub Actions cannot run, a maintainer can run the same release tests
locally with Node 24, required MariaDB and Redis, then inspect and publish:

```sh
npm run check
npm run test:release
npm run framework:publish:test
npm run framework:publish -- --version 0.1.0-beta.5 --tag next --dry-run
npm run framework:publish -- --version 0.1.0-beta.5 --tag next --skip-existing
node scripts/verify-published-framework.mjs 0.1.0-beta.5
```

Select the actual new version and retain the matching source tag and changelog.
Local publication uses npm's interactive authentication and defaults to
`--provenance=false`; a workstation does not have the Actions identity needed
for provenance. The automated workflow explicitly enables `--provenance`.
The publishing script inspects packages but does not run the full test suite.
`--from app` or `--from create` remain available for an inspected partial manual
release. Never substitute local success for verified registry availability.
