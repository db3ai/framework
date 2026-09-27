import { appsPlugin } from '@db3.ai/app/apps/vite';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [appsPlugin(), vue(), tailwindcss()],
	// Resolve shared runtimes from this app when npm nests DOM Studio dependencies.
	resolve: { dedupe: ['vue', '@tiptap/core', '@tiptap/pm'] },
	server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001', '/ws': { target: 'ws://127.0.0.1:3001', ws: true } } },
});
