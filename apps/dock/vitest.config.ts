import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Electron has its own package and runner.
export default mergeConfig(viteConfig, defineConfig({
	test: {
		exclude: [...configDefaults.exclude, 'electron/**'],
		// Supervisor tests spawn real npm processes.
		testTimeout: 30_000,
	},
}));
