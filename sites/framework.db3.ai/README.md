# Framework documentation website

This directory is the deployment root for `framework.db3.ai`. Its root `index.ts`
starts the framework SSR adapter and documentation router. The framework landing
page is `/`; guides are `/docs/...`. `/framework` remains an existing landing URL.
The company homepage and Cloud portal live in a separate private repository.

From the framework repository root, with Node.js 24 or newer:

```sh
npm ci
npm run docs:dev
npm run docs:build
```

Development listens on `http://127.0.0.1:8300`. Set `DOCS_PORT` to use another port.
`DOCS_SITE_URL` controls the trusted canonical origin and defaults to
`https://framework.db3.ai`. `DOCS_HOST` defaults to loopback.

The build regenerates source and API evidence, runs documentation and SSR tests,
checks TypeScript, and builds client, renderer and server runtime. From this
directory `npm start` serves the production build on port 8791. This repository
change does not configure a host, change DNS or deploy that domain.

The source workspaces are build inputs. Deploy the built site with its required
runtime dependencies. Run the production runtime test before promotion:

```sh
npm run test:runtime --workspace @db3.ai/docs
```

Content belongs in `src/articles/` and the registry in `src/docs.ts`. Use supported
public APIs and service-owned examples. Run `npm run docs:generate` after changing
framework APIs, examples, guide text or source registrations. Generated files are
committed and must match the exact framework source in this checkout.
