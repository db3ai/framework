import { resolve } from 'node:path';
import { fastifyViteSsr, type ViteSsrMode } from '@db3.ai/app/ssr/vite';
import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import { Log, registerHttpExchangeMonitor } from '@db3.ai/app/logging';
import { registerBrowserJsonFormatting } from '@db3.ai/app/server/browser-json';
import { registerDocumentationFeeds } from './registerDocumentationFeeds.js';
import { documentationOrigin } from '../client/documentationMarkdown.js';

/**
 * Runtime options for the db3.ai documentation HTTP server.
 */
export interface DocsServerOptions {
	/** Documentation application root containing Vite config and index.html. */
	root?: string;
	/** Explicit Vite runtime mode, normally inferred from NODE_ENV. */
	mode?: ViteSsrMode;
	/** Fastify logger setting, disabled automatically during tests. */
	logger?: boolean;
	/** Canonical public origin shared by rendered metadata and discovery feeds. */
	origin?: string;
}

/**
 * Creates the isolated public db3.ai documentation website server.
 *
 * Static discovery feeds are registered before the framework-owned SSR routes,
 * while unsupported paths remain outside the rendered website boundary.
 *
 * @param options - Application root, runtime mode, logging, and public origin.
 * @returns Configured Fastify server ready to listen or receive injected tests.
 */
export async function createDocsServer(options: DocsServerOptions = {}): Promise<FastifyInstance> {
	const mode = options.mode ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
	const root = resolve(options.root ?? process.env.DOCS_ROOT ?? process.cwd());
	const origin = documentationOrigin(options.origin ?? process.env.DOCS_SITE_URL);
	const environment = mode === 'production' ? 'production' : process.env.NODE_ENV ?? 'development';
	const log = new Log({ environment, enabled: options.logger ?? process.env.NODE_ENV !== 'test', source: 'db3-docs' });
	const server = Fastify({
		loggerInstance: log.logger as FastifyBaseLogger,
		trustProxy: mode === 'production',
	});
	registerBrowserJsonFormatting(server);
	server.addHook('onClose', async () => { await log.close(); });
	registerHttpExchangeMonitor(server, { environment });
	registerDocsSecurityHeaders(server, mode);

	/** Supplies trusted server configuration through the renderer's request context. */
	server.addHook('onRequest', async request => {
		// Overwrite incoming values so a client cannot choose the canonical origin.
		request.headers['x-db3-docs-origin'] = origin;
	});

	server.get('/framework/healthz', async (_request, reply) => {
		reply.header('cache-control', 'no-store');

		return { status: 'ready', ...(process.env.DOCS_RELEASE_REVISION ? { revision: process.env.DOCS_RELEASE_REVISION } : {}) };
	});

	// Vite removes its base prefix while serving modules; SSR retains the public location.
	server.addHook('preHandler', async request => { request.raw.url = request.originalUrl; });

	registerDocumentationFeeds(server, { origin });

	await server.register(fastifyViteSsr({
		root,
		routes: ['/framework', '/framework/', '/framework/docs', '/framework/docs/*'],
		mode,
		viteConfigFile: 'vite.config.ts',
		template: 'index.html',
		developmentEntry: '/client/entry-server.ts',
		developmentAssetRoutes: ['/framework/@vite/*', '/framework/@id/*', '/framework/@fs/*', '/framework/client/*', '/framework/node_modules/*'],
		clientOutDir: 'dist/client',
		serverEntry: 'dist/server/entry-server.js',
		manifest: 'dist/client/.vite/ssr-manifest.json',
		staticAssets: {
			prefix: '/framework/assets/',
			directory: 'dist/client/assets',
		},
	}));

	server.setNotFoundHandler((_request, reply) => {
		reply
			.status(404)
			.header('x-robots-tag', 'noindex, nofollow')
			.type('text/plain; charset=utf-8')
			.send('Page not found');
	});

	return server;
}

/**
 * Applies browser security policy to every documentation response.
 *
 * Development keeps Vite's module and WebSocket behaviour available.
 * Production restricts content to this origin, except DOM Studio's Shiki
 * modules from esm.sh, and allows their WebAssembly engine to compile.
 * HTTPS persistence remains enabled for production responses.
 *
 * @param server - Documentation HTTP server receiving the response hook.
 * @param mode - Runtime mode controlling production-only policy headers.
 */
export function registerDocsSecurityHeaders(server: FastifyInstance, mode: ViteSsrMode): void {
	server.addHook('onRequest', async (_request, reply) => {
		reply
			.header('cross-origin-opener-policy', 'same-origin')
			.header('cross-origin-resource-policy', 'same-origin')
			.header('permissions-policy', 'camera=(), geolocation=(), microphone=()')
			.header('referrer-policy', 'strict-origin-when-cross-origin')
			.header('x-content-type-options', 'nosniff')
			.header('x-frame-options', 'DENY');

		if (mode !== 'production') return;

		reply
			.header('content-security-policy', [
				"default-src 'self'",
				"base-uri 'self'",
				"connect-src 'self'",
				"font-src 'self'",
				"form-action 'self'",
				"frame-ancestors 'none'",
				"img-src 'self' data:",
				"object-src 'none'",
				"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://esm.sh",
				"style-src 'self' 'unsafe-inline'",
			].join('; '))
			.header('strict-transport-security', 'max-age=31536000');
	});
}
