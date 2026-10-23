import { defineConfig } from 'vitest/config';
import { createVitestCacheOptions } from '../../scripts/createVitestCacheOptions.mjs';

export default defineConfig({
	test: {
		// Knex loads generated migrations outside Vite; workers need the application's TypeScript loader.
		execArgv: ['--import', 'tsx'],
		environment: 'node',
		include: [
			'src/**/tests/**/*.test.ts',
		],
		// Each file owns disposable SQL and Redis resources; cap concurrent files to protect CI services.
		fileParallelism: true,
		maxWorkers: 2,
		// Share compiled source across reruns without sharing application or database state.
		experimental: createVitestCacheOptions(new URL('./', import.meta.url), new URL('../../package-lock.json', import.meta.url)),
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			reportOnFailure: true,
			include: ['src/**/*.ts'],
			exclude: [
				'src/**/examples/**',
				'src/**/tests/**',
			],
			thresholds: {
				statements: 75,
				branches: 65,
				functions: 80,
				lines: 77,
			},
		},
	},
});
