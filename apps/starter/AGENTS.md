<!-- @db3.ai/app:start -->
## @db3.ai/app framework

This application uses `@db3.ai/app`.

- Before creating or changing frontend behaviour or framework usage, resolve
  and read the installed framework instructions with
  `node -p "require.resolve('@db3.ai/app/agent-instructions')"`.
- Follow its Frontend development rules: keep Vue components focused on UI,
  move substantial reactive behaviour into feature-owned composables, and keep
  Vue-independent logic in plain TypeScript functions. Existing large components
  are not precedent.
- Treat the installed package exports and declarations as the supported API.
- Keep application-specific models, routes, jobs and policy in this repository.
- Name class-owning TypeScript files and Vue components with PascalCase. The filename must match the primary class or component.
- Name principal public contract/type files with PascalCase. Function modules use camelCase on server and client, matching the primary export: `useInvoice.ts` exports `useInvoice`.
- Prefer behaviour on its owning service or domain object. Group related pure functions in purpose-named camelCase helper modules within that service.
- Keep one main concept per file. Do not copy an inconsistent neighbouring filename as precedent.
- Type-check the application and run focused behavioural tests after changing
  framework usage.
- Report an installed-package documentation or runtime mismatch as a framework
  defect instead of relying on an unexported implementation detail.

## Model definitions

Define new models with `class ModelName extends ActiveRecord.define({ table,
fields: field => ({ id: field.ulid(), ... }) }) {}` from `@db3.ai/app/db`.
Keep field definitions and schema options in the definition, and domain methods
in the class body. Do not add duplicate `declare` properties. Preserve inferred
nullability and use field generics for JSON shapes. `create()` is unsaved;
call `save()` to persist. Host models belong in `server/database/models.ts`;
feature-app models belong in their app's registry and migration workflow.

## Human and agent collaboration

Read `README.md` for current setup, then the focused source and tests. Use
`client/` for browser code, `server/` for backend code, `server/database/` for
migrations and `tests/` for behavior checks. Verify using the commands in the
application's `package.json`; report what ran and what remains unverified.

Keep optional proposals in `plans/`, marked Draft, Exploring or Parked. A plan
is discussion material, not a current API contract or authorization to implement
it. Plans may be checked in, revised or deleted freely. After implementation,
keep only necessary verified usage guidance in the owning README and remove
completed planning sections. Do not make runtime or verification depend on drafts.
<!-- @db3.ai/app:end -->
