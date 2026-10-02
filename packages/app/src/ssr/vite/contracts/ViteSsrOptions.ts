import type { SsrRenderer, SsrState } from '../../contracts';

/** Runtime mode used to select Vite development or production integration. */
export type ViteSsrMode = 'development' | 'production';

/** Production client assets served directly by the SSR web process. */
export interface ViteSsrStaticAssets {
	/** URL prefix reserved for built client assets. */
	prefix: string;
	/** Build directory containing the files exposed below the prefix. */
	directory: string;
}

/**
 * Configuration for a first-class Vite SSR application hosted by Fastify.
 *
 * Paths may be absolute or relative to `root`. The adapter owns Vite's
 * development middleware and immutable production build loading while the
 * application owns the renderer exported by its server entry.
 */
export interface FastifyViteSsrOptions<TState extends object = SsrState> {
	/** Absolute application root containing Vite configuration and source files. */
	root: string;
	/** Explicit public page routes rendered by this SSR application. */
	routes: readonly string[];
	/** Runtime mode, defaulting from `NODE_ENV`. */
	mode?: ViteSsrMode;
	/** Optional Vite config file used by this isolated SSR build in development. */
	viteConfigFile?: string;
	/** Source HTML template transformed by Vite during development. */
	template?: string;
	/** Vite development server-entry module id. */
	developmentEntry?: string;
	/** Additional development-only Vite source routes, for example ['/client/*', '/apps/*']. */
	developmentAssetRoutes?: readonly string[];
	/** Production client build directory containing the transformed template. */
	clientOutDir?: string;
	/** Production server bundle exporting the application renderer. */
	serverEntry?: string;
	/** Production Vite SSR manifest, or false when the app has no client graph. */
	manifest?: string | false;
	/** Named server-entry export implementing the framework renderer contract. */
	renderExport?: string;
	/** Whether JavaScript files observed through the SSR manifest are preloaded. */
	preloadJavaScript?: boolean;
	/** Optional production client asset directory and public prefix. */
	staticAssets?: ViteSsrStaticAssets;
}

/** Server-entry namespace containing a framework-compatible renderer export. */
export type ViteSsrServerModule<TState extends object = SsrState> = Record<
	string,
	SsrRenderer<TState> | unknown
>;
