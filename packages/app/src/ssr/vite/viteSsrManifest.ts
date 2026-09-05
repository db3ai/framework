import type { SsrRenderContext } from '../contracts';

/** Vite SSR manifest mapping rendered module ids to their client build files. */
export type ViteSsrManifest = Record<string, string[]>;

/** Controls which client files should be preloaded for a rendered request. */
export interface ApplyViteSsrManifestOptions {
	/** Whether JavaScript module chunks should be preloaded for hydration. */
	preloadJavaScript?: boolean;
}

/**
 * Adds request-used Vite assets to the single document-head pipeline.
 *
 * @param context - Request-owned SSR context populated by the Vue renderer.
 * @param manifest - Production Vite SSR manifest.
 * @param options - Client preload policy for the current application.
 */
export function applyViteSsrManifest<TState extends object>(
	context: SsrRenderContext<TState>,
	manifest: ViteSsrManifest,
	options: ApplyViteSsrManifestOptions = {},
): void {
	const seen = new Set(context.head.link
		.map(link => typeof link.href === 'string' ? link.href : '')
		.filter(Boolean));

	for (const moduleId of context.modules) {
		for (const file of manifest[moduleId] ?? []) {
			const href = assetHref(file);

			if (!href || seen.has(href)) continue;

			const attributes = preloadAttributes(href, options);

			if (!attributes) continue;

			context.head.link.push(attributes);
			seen.add(href);
		}
	}
}

/**
 * Normalizes one manifest file to a root-relative public URL.
 *
 * @param file - File path emitted by Vite.
 * @returns Root-relative public URL or an empty string.
 */
function assetHref(file: string): string {
	const value = file.trim();

	if (!value) return '';

	return value.startsWith('/') ? value : `/${value}`;
}

/**
 * Maps a built asset to the corresponding preload or stylesheet element.
 *
 * @param href - Root-relative public asset URL.
 * @param options - JavaScript preload policy.
 * @returns Document-head attributes or null for unsupported assets.
 */
function preloadAttributes(
	href: string,
	options: ApplyViteSsrManifestOptions,
): Record<string, string | boolean> | null {
	if (href.endsWith('.css')) {
		return { rel: 'stylesheet', href };
	}

	if (href.endsWith('.js')) {
		return options.preloadJavaScript === false
			? null
			: { rel: 'modulepreload', crossorigin: true, href };
	}

	if (href.endsWith('.woff2')) {
		return { rel: 'preload', href, as: 'font', type: 'font/woff2', crossorigin: true };
	}

	if (href.endsWith('.woff')) {
		return { rel: 'preload', href, as: 'font', type: 'font/woff', crossorigin: true };
	}

	if (/\.(avif|gif|jpe?g|png|webp)$/.test(href)) {
		return { rel: 'preload', href, as: 'image' };
	}

	return null;
}
