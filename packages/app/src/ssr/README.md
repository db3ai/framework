# Server-side rendering

## Runnable public-page boundary

Install `fastify@5`, copy the package's `src/ssr/examples/` into `examples/`,
then run `npx tsx examples/runPublicPages.ts`. The injectable server renders
isolated requests, safely embeds JSON state, preserves literal replacement-token
text, rejects unknown API routes and recovers after a private render failure.
It needs no SQL, listening port, Vue build or provider credentials. The exact
consumer test is `tests/examples/runPublicPages.test.ts`. It proves the adapter
boundary, not a complete Vue hydration or production proxy configuration.

Document substitution treats rendered values literally, including `$&` and
marker-like text in application output. Body markup still must be trusted;
literal insertion is not HTML sanitization.

`@db3.ai/app/ssr` provides the transport-neutral boundary for rendering public
HTML. It deliberately does not live on `App`: SSR is an optional web delivery
concern, while queues, schedulers, APIs and other processes can continue using
the framework without Vue, Vite or Fastify SSR dependencies.

The initial framework component owns:

- one isolated render context per request;
- document head and render-result contracts;
- safe JSON hydration-state serialization;
- deterministic HTML document assembly;
- an optional Fastify adapter with its own error boundary;
- a first-class Vite/Fastify lifecycle adapter for development and production.

The host application owns its Vue app, router, page data loading, client and
server entries. The optional Vite adapter owns development middleware,
production bundle loading, manifest links, and static asset registration. SSR
data should still be loaded through the application's HTTP API rather than
importing app models into the frontend server entry.

## Document template

The application marker is required. Head and state markers are optional for
documents that intentionally do not hydrate in the browser.

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
		<!--platform-ssr-head-->
	</head>
	<body>
		<div id="app"><!--platform-ssr-app--></div>
		<script id="__PLATFORM_SSR_STATE__" type="application/json"><!--platform-ssr-state--></script>
		<script type="module" src="/src/entry-client.ts"></script>
	</body>
</html>
```

The state marker receives escaped JSON, not executable JavaScript. The client
entry can parse it before hydrating:

```ts
const element = document.querySelector('#__PLATFORM_SSR_STATE__');
const state = JSON.parse(element?.textContent || '{}');
```

## Fastify adapter

Install Fastify in the host application and register the optional adapter:

```ts
import Fastify from 'fastify';
import { fastifySsr } from '@db3.ai/app/ssr/fastify';
import template from './index.html?raw';
import { renderPage } from './src/entry-server';

const server = Fastify();

server.get('/api/health', async () => ({ ok: true }));

await server.register(fastifySsr({
	template,
	render: renderPage,
	routes: ['/blog', '/blog/*'],
	shouldRender: (request) => {
		const path = request.url.split('?')[0];
		return path !== '/api' && !path.startsWith('/api/');
	},
}));
```

Prefer explicit `routes` when SSR owns a contained public surface. When omitted,
the adapter retains its `/*` fallback for applications whose complete page
surface is server rendered. Fastify's specific routes take precedence over that
fallback. `shouldRender` remains an additional guard for reserved route prefixes
so an unknown API route does not accidentally receive an HTML page.

The application renderer returns markup and can collect status, head metadata
and hydration state on its request-owned context:

```ts
import type { SsrRenderer } from '@db3.ai/app/ssr';

export const renderPage: SsrRenderer = async (context) => {
	context.head.title = 'Example App';
	context.state.page = await loadPageThroughHttpApi(context.request.url);

	return {
		appHtml: renderApplicationMarkup(context.state.page),
	};
};
```

Create a fresh Vue application, router and store inside every call to the
renderer. Module-level mutable auth, router or store state can leak between
concurrent requests and must not be used.

## Vite and Fastify integration

`@db3.ai/app/ssr/vite` provides the complete Vite lifecycle while retaining
explicit route ownership:

```ts
import Fastify from 'fastify';
import { fastifyViteSsr } from '@db3.ai/app/ssr/vite';

const server = Fastify();

await server.register(fastifyViteSsr({
	root: import.meta.dirname,
	routes: ['/blog', '/blog/*'],
	viteConfigFile: 'vite.marketing.config.ts',
	template: 'marketing.html',
	developmentEntry: '/src/marketing/entry-server.ts',
	preloadJavaScript: false,
	staticAssets: {
		prefix: '/site-assets/',
		directory: 'dist/client/site-assets',
	},
}));
```

`viteConfigFile` lets one application keep its SPA and SSR marketing graphs
separate while sharing the same source tree. The SSR adapter uses that config
for development transforms; production continues loading the explicit client
and server output paths supplied by the application.

In development the adapter uses Vite middleware mode, transforms the HTML shell
per request, hot-loads `/src/entry-server.ts`, and makes Vite's source, module,
dependency, filesystem, and HMR URL namespaces available to the browser. Unknown
page URLs still fall through to the application's ordinary not-found boundary.
For a site organized into `client/` and feature folders, set
`developmentEntry: '/client/entry-server.ts'` and
`developmentAssetRoutes: ['/client/*', '/apps/*']`. These explicit source routes
extend Vite's built-in development namespaces. They do not change page routing
or expose those source directories in production. Keep API routes with the host;
do not include them in `developmentAssetRoutes`.
In production it reads `dist/client/index.html`, imports
`dist/server/entry-server.js`, serves the configured asset directory, and maps
`context.modules` through Vite's SSR manifest. Set `preloadJavaScript: false`
for HTML/CSS-only pages; hydrating apps can retain the default module-preload
behavior.

This makes SSR designation deliberate and visible: a page is server-rendered
only when the application router implements it and its URL appears in the
adapter's `routes` list. An existing SPA can continue owning every other route.
