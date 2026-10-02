import { readFile } from 'node:fs/promises';
import type { Server as HttpServer } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyPluginAsync } from 'fastify';
import type { ViteDevServer } from 'vite';

import type { SsrRenderer, SsrRequest, SsrState } from '../contracts';
import { fastifySsr } from '../fastify';
import type { FastifyViteSsrOptions, ViteSsrServerModule } from './contracts';
import { applyViteSsrManifest, type ViteSsrManifest } from './viteSsrManifest';

const DEFAULT_TEMPLATE = 'index.html';
const DEFAULT_DEVELOPMENT_ENTRY = '/src/entry-server.ts';
const DEFAULT_CLIENT_OUT_DIR = 'dist/client';
const DEFAULT_SERVER_ENTRY = 'dist/server/entry-server.js';
const DEFAULT_MANIFEST = 'dist/client/.vite/ssr-manifest.json';
const DEFAULT_RENDER_EXPORT = 'render';
const DEVELOPMENT_ASSET_ROUTES = [
	'/@vite/*',
	'/@id/*',
	'/@fs/*',
	'/src/*',
	'/node_modules/*',
] as const;

/**
 * Creates a Fastify plugin that owns Vite development and production SSR.
 *
 * The adapter loads application code through Vite in development, immutable
 * build artifacts in production, optional static assets, and route-specific
 * manifest links. Vue, routing and page data remain application concerns.
 *
 * @param options - Vite application paths and explicit SSR route ownership.
 * @returns Fastify plugin ready to register on a web-delivery process.
 *
 * @example
 * await server.register(fastifyViteSsr({
 * 	root: import.meta.dirname,
 * 	routes: ['/blog', '/blog/*'],
 * 	staticAssets: {
 * 		prefix: '/site-assets/',
 * 		directory: 'dist/client/site-assets',
 * 	},
 * }));
 */
export function fastifyViteSsr<TState extends object = SsrState>(
	options: FastifyViteSsrOptions<TState>,
): FastifyPluginAsync {
	return async function platformFastifyViteSsr(server): Promise<void> {
		if (!options.routes.length) {
			throw new Error('Vite SSR requires at least one explicit page route.');
		}

		const mode = options.mode ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');

		if (mode === 'development') {
			const runtime = await developmentRuntime(server.server, options);

			await server.register((await import('@fastify/middie')).default);
			server.use(runtime.vite.middlewares);
			registerDevelopmentAssetRoutes(server, options.developmentAssetRoutes);
			server.addHook('onClose', async () => {
				await runtime.vite.close();
			});
			await server.register(fastifySsr({
				routes: options.routes,
				template: runtime.template,
				render: runtime.render,
			}));

			return;
		}

		if (options.staticAssets) {
			await server.register((await import('@fastify/static')).default, {
				root: applicationPath(options.root, options.staticAssets.directory),
				prefix: normalizedAssetPrefix(options.staticAssets.prefix),
				index: false,
			});
		}

		const runtime = await productionRuntime(options);

		await server.register(fastifySsr({
			routes: options.routes,
			template: runtime.template,
			render: runtime.render,
		}));
	};
}

/**
 * Registers the Vite URL namespaces needed by browser development requests.
 *
 * Fastify resolves a route before running encapsulated middleware. These
 * fallback routes keep Vite's middleware reachable for source styles, module
 * transforms, dependency chunks, and its HMR client without claiming unrelated
 * application page URLs. When Vite does not handle a matching request, the
 * application's ordinary not-found boundary remains authoritative.
 *
 * @param server - Encapsulated Fastify instance hosting the Vite middleware.
 * @param additionalRoutes - Explicit browser source namespaces owned by this application.
 */
function registerDevelopmentAssetRoutes(server: Parameters<FastifyPluginAsync>[0], additionalRoutes: readonly string[] = []): void {
	for (const route of new Set([...DEVELOPMENT_ASSET_ROUTES, ...additionalRoutes])) {
		server.get(route, (_request, reply) => reply.callNotFound());
	}
}

/** Vite development runtime loaded once for one Fastify server. */
interface DevelopmentRuntime<TState extends object> {
	/** Active Vite middleware server. */
	vite: ViteDevServer;
	/** Request-aware transformed HTML template loader. */
	template: (request: SsrRequest) => Promise<string>;
	/** Hot-reloaded application renderer. */
	render: SsrRenderer<TState>;
}

/** Immutable production renderer and HTML shell. */
interface ProductionRuntime<TState extends object> {
	/** Transformed client-build document template. */
	template: string;
	/** Built application renderer with manifest integration. */
	render: SsrRenderer<TState>;
}

/**
 * Creates Vite middleware and hot server-entry loading for development.
 *
 * @param httpServer - Fastify's underlying HTTP server used for Vite HMR.
 * @param options - Vite SSR application options.
 * @returns Development runtime consumed by the transport adapter.
 */
async function developmentRuntime<TState extends object>(
	httpServer: HttpServer,
	options: FastifyViteSsrOptions<TState>,
): Promise<DevelopmentRuntime<TState>> {
	const { createServer } = await import('vite');
	const vite = await createServer({
		root: options.root,
		configFile: options.viteConfigFile
			? applicationPath(options.root, options.viteConfigFile)
			: undefined,
		appType: 'custom',
		server: {
			middlewareMode: true,
			hmr: { server: httpServer },
		},
	});
	const templatePath = applicationPath(options.root, options.template ?? DEFAULT_TEMPLATE);
	const developmentEntry = options.developmentEntry ?? DEFAULT_DEVELOPMENT_ENTRY;
	const renderExport = options.renderExport ?? DEFAULT_RENDER_EXPORT;

	return {
		vite,
		template: async request => {
			const template = await readFile(templatePath, 'utf8');

			return vite.transformIndexHtml(request.url, template);
		},
		render: async context => {
			try {
				const module = await vite.ssrLoadModule(developmentEntry) as ViteSsrServerModule<TState>;
				const render = moduleRenderer<TState>(module, renderExport);

				return await render(context);
			} catch (error) {
				vite.ssrFixStacktrace(error as Error);
				throw error;
			}
		},
	};
}

/**
 * Loads immutable production templates, server code and optional manifest data.
 *
 * @param options - Vite SSR application options.
 * @returns Production runtime consumed by the transport adapter.
 */
async function productionRuntime<TState extends object>(
	options: FastifyViteSsrOptions<TState>,
): Promise<ProductionRuntime<TState>> {
	const clientOutDir = options.clientOutDir ?? DEFAULT_CLIENT_OUT_DIR;
	const templatePath = applicationPath(
		options.root,
		join(clientOutDir, options.template ?? DEFAULT_TEMPLATE),
	);
	const serverEntry = applicationPath(options.root, options.serverEntry ?? DEFAULT_SERVER_ENTRY);
	const renderExport = options.renderExport ?? DEFAULT_RENDER_EXPORT;
	const [template, module, manifest] = await Promise.all([
		readFile(templatePath, 'utf8'),
		import(pathToFileURL(serverEntry).href) as Promise<ViteSsrServerModule<TState>>,
		loadManifest(options),
	]);
	const render = moduleRenderer<TState>(module, renderExport);

	return {
		template,
		render: async context => {
			const result = await render(context);

			applyViteSsrManifest(context, manifest, {
				preloadJavaScript: options.preloadJavaScript,
			});

			return result;
		},
	};
}

/**
 * Loads the optional production SSR manifest.
 *
 * @param options - Vite SSR application options.
 * @returns Parsed manifest or an empty map when explicitly disabled.
 */
async function loadManifest<TState extends object>(
	options: FastifyViteSsrOptions<TState>,
): Promise<ViteSsrManifest> {
	if (options.manifest === false) return {};

	const path = applicationPath(options.root, options.manifest ?? DEFAULT_MANIFEST);
	const value = JSON.parse(await readFile(path, 'utf8')) as unknown;

	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Vite SSR manifest must contain an object: ${path}`);
	}

	return value as ViteSsrManifest;
}

/**
 * Resolves the configured server-entry renderer and validates its contract.
 *
 * @param module - Loaded development or production module namespace.
 * @param name - Named renderer export.
 * @returns Framework-compatible application renderer.
 */
function moduleRenderer<TState extends object>(
	module: ViteSsrServerModule<TState>,
	name: string,
): SsrRenderer<TState> {
	const render = module[name];

	if (typeof render !== 'function') {
		throw new Error(`Vite SSR server entry must export a "${name}" renderer.`);
	}

	return render as SsrRenderer<TState>;
}

/**
 * Resolves an application-owned path without changing absolute paths.
 *
 * @param root - Absolute application root.
 * @param path - Absolute or application-relative path.
 * @returns Absolute filesystem path.
 */
function applicationPath(root: string, path: string): string {
	return isAbsolute(path) ? path : resolve(root, path);
}

/**
 * Normalizes a Fastify static prefix to an absolute trailing-slash path.
 *
 * @param prefix - Application-provided public asset prefix.
 * @returns Normalized Fastify route prefix.
 */
function normalizedAssetPrefix(prefix: string): string {
	const value = `/${prefix.trim().replace(/^\/+|\/+$/g, '')}/`;

	if (value === '//') {
		throw new Error('Vite SSR static asset prefix cannot be empty.');
	}

	return value;
}
