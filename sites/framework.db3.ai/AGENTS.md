# Documentation agent instructions

Read README.md, src/docs.ts and the owning service README before editing a guide.
The deployable entry point is index.ts; the SSR factory is server/createDocsServer.ts.
Keep company marketing and private application content out of this public site.

Explain real workflows with complete examples, supported imports, normal options
and failure behavior. Plans and future product concepts are not implemented APIs.
Regenerate source evidence with `npm run docs:generate` at repository root and run
`npm run docs:build`. Check rendered pages after presentation changes using a
dedicated agent-owned browser session, and clean up that session afterward.
