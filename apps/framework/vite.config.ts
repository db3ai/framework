import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const clientRoot = fileURLToPath(new URL('./client', import.meta.url));

/**
 * Preserves DOM Studio's headless custom elements during Vue template compilation.
 *
 * @param tag - Template element name being classified by Vue.
 * @returns Whether the element belongs to DOM Studio's custom-element runtime.
 */
function isDomStudioCustomElement(tag: string): boolean {
	return tag.startsWith('dom-');
}

export default defineConfig({
	base: '/framework/',
	plugins: [
		tailwindcss(),
		vue({
			template: {
				compilerOptions: {
					isCustomElement: isDomStudioCustomElement,
				},
			},
		}),
	],
	resolve: {
		dedupe: ['vue'],
		alias: {
			'@': clientRoot,
		},
	},
	ssr: {
		noExternal: ['@getdom/studio', '@db3.ai/app'],
	},
	server: {
		port: 8300,
		strictPort: true,
		allowedHosts: ['local.db3.ai'],
		fs: {
			allow: [repoRoot],
		},
	},
});
