import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';

import { app, clearActiveApp, setActiveApp, type AppDatabaseProvider } from '..';

describe('app context', () => {
	afterEach(() => {
		clearActiveApp();
	});

	it('returns the active application service hub', () => {
		const active = {
			db: {
				knex: {} as Knex,
			},
			serviceName: 'test-app',
		} satisfies AppDatabaseProvider & {
			serviceName: string;
		};

		setActiveApp(active);

		expect(app<typeof active>()).toBe(active);
		expect(app<typeof active>().serviceName).toBe('test-app');
	});

	it('fails clearly before an application is active', () => {
		clearActiveApp();

		expect(() => app()).toThrow('No active application has been created.');
	});
});
