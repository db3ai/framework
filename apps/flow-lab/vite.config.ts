import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { optionalPort } from '@db3.ai/pure/urls';

const apiPort = process.env.FLOW_LAB_API_PORT || process.env.API_PORT || process.env.PORT || '8788';
const apiHost = process.env.FLOW_LAB_API_HOST || process.env.API_HOST || '127.0.0.1';
const clientHost = process.env.FLOW_LAB_CLIENT_HOST || process.env.CLIENT_HOST || process.env.VITE_HOST || '127.0.0.1';
const clientPort = optionalPort(process.env.FLOW_LAB_CLIENT_PORT || process.env.CLIENT_PORT || process.env.VITE_PORT || '5178');

export default defineConfig({
	plugins: [vue()],
	resolve: {
		dedupe: ['vue'],
	},
	server: {
		host: clientHost,
		port: clientPort,
		proxy: {
			'/api': {
				target: `http://${apiHost}:${apiPort}`,
				changeOrigin: true,
			},
		},
	},
});
