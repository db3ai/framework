import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Electron has its own Node runner and real desktop process tests.
export default mergeConfig(viteConfig, defineConfig({
	test: {
		exclude: [...configDefaults.exclude, 'electron/**'],
		// Integration cases create and migrate real disposable databases.
		// CI remains serial; a larger test host can opt in with --maxWorkers=2.
		maxWorkers: 1,
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
}));
