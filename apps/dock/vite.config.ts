import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const apiPort = process.env.DOCK_PORT || '8790';
const clientPort = Number(process.env.DOCK_CLIENT_PORT || 5179);

export default defineConfig({
	plugins: [vue()],
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
