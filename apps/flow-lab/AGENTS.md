# Flow Lab agent guide

Standalone framework flow examples and runtime tests. Cloud product work belongs in the separate db3.ai repository, apps/flows.

Read [README.md](README.md) for current setup and behavior, and the shared
[framework conventions](../../packages/app/CONVENTIONS.md) when changing DB3
usage. Root `AGENTS.md` applies; do not duplicate its rules here.

Start with `server/app.ts`, `server/index.ts`, `src/App.vue`, then the focused owner and tests.
Framework flow behavior belongs in `packages/app/src/flows/`; app-specific demonstrations remain here.

Verify with `npm test --workspace flow-lab` and `npm run type-check --workspace flow-lab`.

Discuss ideas in [plans/](plans/README.md). Plans are optional, disposable
drafts, not API contracts, implementation instructions or permission to change
code. Keep implemented usage in the owning README. Report checks actually run
and distinguish local results from deployment and live proof.
