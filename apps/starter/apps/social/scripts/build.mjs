import { spawnSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';

const root = fileURLToPath(new URL('../', import.meta.url));
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
const result = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Social declarations or server compilation failed.');
await cp(new URL('../database/', import.meta.url), new URL('../dist/database/', import.meta.url), { recursive: true });
await build({
	configFile: false, logLevel: 'silent', root, plugins: [vue()],
	build: {
		outDir: 'dist/client', emptyOutDir: false,
		lib: { entry: fileURLToPath(new URL('../client/index.ts', import.meta.url)), formats: ['es'], fileName: () => 'index.js' },
		rollupOptions: { external: ['vue'] },
	},
});
