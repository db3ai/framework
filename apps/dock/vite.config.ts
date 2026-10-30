import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

const apiPort = process.env.DOCK_PORT || '8790';
const clientPort = Number(process.env.DOCK_CLIENT_PORT || 5179);

export default defineConfig({
	// Tailwind only builds the console screens' styles (client/console.css); Dock's own CSS is plain.
	plugins: [vue({ template: { compilerOptions: {
		/** Keeps getdom.studio's web components native instead of resolving their Vue wrappers recursively. */
		isCustomElement: tag => tag.startsWith('dom-'),
	} } }), tailwindcss()],
	resolve: {
		dedupe: ['vue'],
	},
	build: {
		// xterm.js and its WebGL renderer; Dock is served from this machine only.
		chunkSizeWarningLimit: 1500,
	},
	server: {
		host: '127.0.0.1',
		port: clientPort,
		strictPort: true,
		proxy: {
			'/api': {
				target: `http://127.0.0.1:${apiPort}`,
				// The terminal input socket lives under /api too.
				ws: true,
			},
		},
	},
});
