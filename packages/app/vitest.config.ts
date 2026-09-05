import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: [
			'src/**/tests/**/*.test.ts',
		],
		fileParallelism: false,
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
