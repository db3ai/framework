import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Electron has its own Node runner and real desktop process tests.
export default mergeConfig(viteConfig, defineConfig({
	test: {
		exclude: [...configDefaults.exclude, 'electron/**'],
		// Integration cases create and migrate real disposable databases.
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
}));
