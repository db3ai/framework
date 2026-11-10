import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocsServer } from '../dist/runtime/index.js';

/**
 * Writes the built documentation website as static files, so a host serves `/framework` from
 * disk with `registerStaticSite` instead of running the docs server (db3.ai does). Every page,
 * feed, Markdown copy, image and asset is rendered once through the production server.
 *
 * Output: dist/site, an installable package `@db3.ai/docs-site` whose `index.js` exports the
 * files' `directory` and the `headers(file)` the docs server sends (security policy, caching):
 * `registerStaticSite(server, { prefix: '/framework', ...docsSite })`.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'dist/site');
const origin = process.env.DOCS_SITE_URL || 'https://db3.ai';
const missing = '/framework/__missing__';
/** Response headers that describe one transfer, not the document. */
const transient = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'etag', 'last-modified', 'accept-ranges', 'vary']);

const server = await createDocsServer({ root, mode: 'production', logger: false, origin });
try {
	await rm(output, { recursive: true, force: true });
	const routes = {};
	const queue = ['/framework', '/framework/learn', '/framework/llms.txt', '/framework/llms-full.txt', '/framework/sitemap.xml', '/framework/robots.txt'];
	for (const directory of ['assets', 'images']) for (const file of await walk(join(root, 'dist/client', directory))) queue.push(`/framework/${directory}/${relative(join(root, 'dist/client', directory), file).split('\\').join('/')}`);
	const seen = new Set(queue);
	while (queue.length) {
		const path = queue.shift();
		const response = await server.inject(path);
		if (response.statusCode !== 200) throw new Error(`${path} answered ${response.statusCode}; every linked documentation path must exist.`);
		routes[path] = await save(path, response);
		const type = String(response.headers['content-type'] ?? '');
		// Pages and feeds link the rest of the site; assets are already listed from disk.
		if (!/text\/(html|plain|markdown)|xml/.test(type)) continue;
		for (const match of response.body.matchAll(new RegExp(`(?:${escape(origin)}|(?<![\\w.:/-]))(/framework(?:/[^\\s"'<>()#?\\\\]*)?)`, 'g'))) {
			const linked = match[1].replace(/[.,;:]+$/, '').replace(/\/$/, '') || '/framework';
			if (seen.has(linked) || linked.startsWith('/framework/assets/') || linked.startsWith('/framework/images/') || linked === '/framework/healthz') continue;
			seen.add(linked);
			queue.push(linked);
		}
	}
	routes['404'] = await save(missing, await server.inject(missing));
	// One header set for every file (the docs server's security policy), and its caching per kind of file.
	const page = routes['/framework'].headers;
	const cache = { assets: routes[Object.keys(routes).find(path => path.startsWith('/framework/assets/'))]?.headers['cache-control'], images: routes[Object.keys(routes).find(path => path.startsWith('/framework/images/'))]?.headers['cache-control'], feeds: routes['/framework/llms.txt'].headers['cache-control'], pages: page['cache-control'] };
	const security = Object.fromEntries(Object.entries(page).filter(([key]) => key !== 'content-type' && key !== 'cache-control'));
	const fingerprint = createHash('sha256').update(JSON.stringify(routes)).digest('hex').slice(0, 16);
	await writeFile(join(output, 'index.js'), `import { fileURLToPath } from 'node:url';

/** db3.ai framework documentation (${fingerprint}), rendered for ${origin}. Serve with registerStaticSite under /framework. */
export const directory = fileURLToPath(new URL('./files', import.meta.url));
const security = ${JSON.stringify(security)};
const cache = ${JSON.stringify(cache)};

/** The headers the documentation server sends for one file (path relative to directory). */
export function headers(file) {
	const kind = file.startsWith('assets/') ? 'assets' : file.startsWith('images/') ? 'images' : file.endsWith('.html') ? 'pages' : 'feeds';
	return { ...security, ...(cache[kind] ? { 'cache-control': cache[kind] } : {}) };
}
`);
	await writeFile(join(output, 'index.d.ts'), 'export declare const directory: string;\nexport declare function headers(file: string): Record<string, string>;\n');
	await writeFile(join(output, 'package.json'), `${JSON.stringify({ name: '@db3.ai/docs-site', version: '0.1.0', description: 'The db3.ai framework documentation website as static files.', license: 'MIT', type: 'module', files: ['index.js', 'index.d.ts', 'files'], exports: { '.': { types: './index.d.ts', default: './index.js' } } }, null, '\t')}\n`);
	console.log(`Exported ${Object.keys(routes).length} documentation files to dist/site (${fingerprint}).`);
} finally {
	await server.close();
}

/**
 * Stores one response body under a name derived from its path and returns how to replay it.
 * @param {string} path - Public path.
 * @param {import('light-my-request').Response} response - Rendered response.
 */
async function save(path, response) {
	const name = path === missing ? '404.html' : /\.[a-z0-9]+$/i.test(path) ? path.slice('/framework/'.length) : `${path.slice('/framework'.length).replace(/^\//, '') || 'index'}.html`;
	const file = join(output, 'files', name);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, response.rawPayload);
	const headers = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !transient.has(key.toLowerCase())).map(([key, value]) => [key.toLowerCase(), String(value)]));
	return { file: name, status: response.statusCode, headers };
}

/** Lists every file below a directory. */
async function walk(directory) {
	const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
	return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}

/** Escapes text for a regular expression. */
function escape(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
