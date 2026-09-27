import type { Plugin } from 'vite';
import { discoverApps } from './discoverApps';
import { writeAppTypes } from './writeAppTypes';

/** Supplies discovered browser entries, Tailwind sources and app service types without per-app host imports. */
export function appsPlugin(): Plugin {
	let root: string;
	return {
		name: 'db3-apps', enforce: 'pre',
		/** Generates declarations using Vite's resolved application root. */
		async configResolved(config) { root = config.root; await writeAppTypes(root); },
		/** Resolves the browser-only virtual registry. */
		resolveId(id) { if (id === 'virtual:db3/apps') return '\0virtual:db3/apps'; },
		/** Emits lazy browser imports; server entries never enter the client graph. */
		load(id) {
			if (id !== '\0virtual:db3/apps') return;
			return `export default [${discoverApps(root).filter(app => app.client).map(app => `{ id: ${JSON.stringify(app.manifest.id)}, load: () => import(${JSON.stringify(app.client!.replaceAll('\\', '/'))}) }`).join(',')}];`;
		},
		/** Includes app-owned utility classes, including those shipped inside npm packages. */
		transform(code, id) {
			if (!id.endsWith('.css') || !code.includes('tailwindcss')) return;
			const sources = discoverApps(root).filter(app => app.client).map(app => `@source ${JSON.stringify(app.directory.replaceAll('\\', '/'))};`);
			return `${code}\n${sources.join('\n')}`;
		},
		/** Rebuilds the registry when folders or package installation metadata change in development. */
		configureServer(server) {
			server.watcher.add([`${root}/apps`, `${root}/package.json`]);
			/** Restarts Vite only for discovery inputs; normal source changes retain regular HMR. */
			const refresh = (path: string) => { if (path.endsWith('/manifest.json') || path === `${root}/package.json`) void server.restart(); };
			server.watcher.on('add', refresh).on('unlink', refresh).on('change', refresh);
			server.httpServer?.once('close', () => { server.watcher.off('add', refresh).off('unlink', refresh).off('change', refresh); });
		},
	};
}
