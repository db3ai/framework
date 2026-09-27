import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Electron has its own Node runner and real desktop process tests.
export default mergeConfig(viteConfig, defineConfig({
	test: { exclude: [...configDefaults.exclude, 'electron/**'] },
}));
