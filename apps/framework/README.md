# Framework documentation website

This directory owns `https://db3.ai/framework`. Its root `index.ts` starts the
framework SSR adapter and documentation router. The landing page is `/framework`;
guides are `/framework/docs/...`. Assets, health, Markdown feeds and the sitemap
also live under `/framework`. The company homepage and Cloud portal live in the
separate private `db3.ai` repository.

`client/` owns the Vue frontend, articles and generated documentation. `server/`
owns the HTTP and SSR host; `scripts/` generates source evidence, and `tests/`
verifies the documentation and runtime.

From the framework repository root, with Node.js 24 or newer:

```sh
npm ci
npm run docs:dev
npm run docs:build
```

Development listens at `http://127.0.0.1:8300/framework`. Set `DOCS_PORT` to use
another port. `DOCS_SITE_URL` controls the trusted canonical **origin** and defaults
to `https://db3.ai`; do not include `/framework` in that setting. `DOCS_HOST`
defaults to loopback. Vite serves its modules under `/framework/` too.

The domain router must send both `/framework` and `/framework/*` to this runtime,
**preserving the prefix**, and send other paths to the company host. The private
`db3.ai` repository owns the shared Caddy snippet in `operations/site.Caddyfile`
and its local setup instructions in `operations/README.md`. That host redirects
legacy `/docs/...` and root Markdown feeds and publishes root `robots.txt`.
This runtime intentionally does not serve the company homepage or root assets.

The build regenerates source and API evidence, runs documentation and SSR tests,
checks TypeScript, and builds client, renderer and server runtime. From this
directory `npm start` serves the production build on port 8791. The readiness URL
is `/framework/healthz`. These source changes do not deploy or switch production.

Deploy the built site with its required runtime dependencies. Run the production
runtime test before promotion:

```sh
npm run test:runtime --workspace @db3.ai/docs
```

Content belongs in `client/articles/` and the registry in `client/docs.ts`. Use supported
public APIs and service-owned examples. Run `npm run docs:generate` after changing
framework APIs, examples, guide text or source registrations. Generated files are
committed and must match the exact framework source in this checkout.
