import { describe, expect, it } from 'vitest';
import {
	isSqlError,
	publicSqlErrorMessage,
	shouldExposeSqlErrorDetails,
} from '../index';

describe('SQL error public messages', () => {
	it('shows SQL error details only when development is explicit', () => {
		const error = Object.assign(
			new Error('insert into `users` (`email`) values (?) - Duplicate entry'),
			{
				code: 'ER_DUP_ENTRY',
				sql: 'insert into `users` (`email`) values (?)',
			},
		);

		expect(isSqlError(error)).toBe(true);
		expect(shouldExposeSqlErrorDetails('')).toBe(false);
		expect(shouldExposeSqlErrorDetails('develop')).toBe(true);
		expect(shouldExposeSqlErrorDetails('development')).toBe(true);
		expect(publicSqlErrorMessage(error, {
			environment: '',
		})).toBe('A database error occurred.');
		expect(publicSqlErrorMessage(error, {
			environment: 'develop',
		})).toContain('insert into `users`');
		expect(publicSqlErrorMessage(error, {
			environment: 'development',
		})).toContain('insert into `users`');
	});

	it('hides SQL error details when NODE_ENV is unset', () => {
		const previousNodeEnv = process.env.NODE_ENV;

		delete process.env.NODE_ENV;

		try {
			const error = Object.assign(
				new Error('select * from `users` - syntax error'),
				{
					code: 'ER_PARSE_ERROR',
					sql: 'select * from `users`',
				},
			);

			expect(shouldExposeSqlErrorDetails()).toBe(false);
			expect(publicSqlErrorMessage(error)).toBe('A database error occurred.');
		} finally {
			if (previousNodeEnv === undefined) {
				delete process.env.NODE_ENV;
			} else {
				process.env.NODE_ENV = previousNodeEnv;
			}
		}
	});

	it('hides SQL error details in production', () => {
		const error = Object.assign(
			new Error('insert into `users` (`password`) values (?) - Column cannot be null'),
			{
				code: 'ER_BAD_NULL_ERROR',
				sqlState: '23000',
			},
		);

		expect(shouldExposeSqlErrorDetails('production')).toBe(false);
		expect(publicSqlErrorMessage(error, {
			environment: 'production',
		})).toBe('A database error occurred.');
		expect(publicSqlErrorMessage(error, {
			environment: 'production',
			productionMessage: 'Unexpected server error',
		})).toBe('Unexpected server error');
	});

	it('ignores non-SQL errors', () => {
		expect(publicSqlErrorMessage(new Error('ordinary failure'))).toBeNull();
		expect(isSqlError(Object.assign(new Error('operation not permitted'), {
			code: 'EPERM',
		}))).toBe(false);
	});
});
