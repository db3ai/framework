import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

/** Options for {@link registerStaticSite}. */
export interface StaticSiteOptions {
	/** Public path the site lives under, such as `/framework`, or `/` for the whole origin. */
	prefix: string;
	/** Folder holding the site's files. */
	directory: string;
	/**
	 * Headers for every response (security policy, cache), or a function choosing them from the
	 * file's path relative to `directory`, such as long caching for `assets/`.
	 */
	headers?: Record<string, string> | ((file: string) => Record<string, string>);
	/** Page sent with status 404 for paths with no file, relative to `directory`. Default `404.html`. */
	notFound?: string;
}

/** Content types for the files a website ships; anything else is sent as bytes. */
const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
	'.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
	'.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
	'.mp4': 'video/mp4', '.webm': 'video/webm',
};

/**
 * Serves a folder of files as a website under `prefix`, with clean URLs: `/docs/apps` sends
 * `docs/apps.html` (or `docs/apps/index.html`), and the prefix itself sends `index.html`. Paths
 * never leave the folder, dotfiles are never served, and a path with no file gets the
 * not-found page.
 *
 * @param server - Fastify server or plugin scope.
 * @param options - Where the site lives, its folder, headers and not-found page.
 *
 * @example
 * registerStaticSite(server, { prefix: '/docs', directory: 'dist/site', headers: { 'cache-control': 'public, max-age=300' } });
 */
export function registerStaticSite(server: FastifyInstance, options: StaticSiteOptions): void {
	const root = resolve(options.directory);
	const prefix = `/${options.prefix.replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
	const headersFor = typeof options.headers === 'function' ? options.headers : () => (options.headers as Record<string, string> | undefined) ?? {};
	const notFound = options.notFound ?? '404.html';

	/** Finds the file a relative URL path names, or null. */
	async function find(path: string): Promise<string | null> {
		let decoded: string;
		try { decoded = decodeURIComponent(path); } catch { return null; }
		if (decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) return null;
		const base = decoded.replace(/^\/+|\/+$/g, '');
		const candidates = base ? (extname(base) ? [base] : [`${base}.html`, `${base}/index.html`]) : ['index.html'];
		for (const candidate of candidates) {
			const file = resolve(root, candidate);
			if (file !== root && !file.startsWith(`${root}${sep}`)) return null;
			if ((await stat(file).catch(() => null))?.isFile()) return candidate;
		}
		return null;
	}

	/** Sends one file with its type and headers. */
	function send(reply: FastifyReply, file: string, status = 200) {
		return reply.code(status).headers(headersFor(file)).type(TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream').send(createReadStream(join(root, file)));
	}

	const handler = async (request: { url: string }, reply: FastifyReply) => {
		const path = request.url.split('?')[0]!.slice(prefix.length);
		const file = await find(path);
		if (file) return send(reply, file);
		if (await find(notFound)) return send(reply, notFound, 404);
		return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
	};
	if (prefix) server.get(prefix, handler);
	server.get(`${prefix}/*`, handler);
}
