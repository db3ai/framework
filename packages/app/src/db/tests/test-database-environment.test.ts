import { describe, expect, it } from 'vitest';

describe('framework test database environment', () => {
	it('targets the framework test-only database namespace', () => {
		expect(process.env.NODE_ENV).toBe('test');
		expect(process.env.DB_DATABASE).toBe('db3_app_test');
		expect(process.env.DB_TEST_DATABASE_PREFIX).toBe('db3_app_test');
	});
});
