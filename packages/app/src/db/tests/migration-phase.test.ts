import { describe, expect, it } from 'vitest';
import { readMigrationPhase } from '@db3.ai/app/db/migrations';

describe('migration phases', () => {
	it('reads literal declarations and treats undeclared migrations as contract', () => {
		expect(readMigrationPhase('export const phase = "expand";\nexport async function up() {}')).toBe('expand');
		expect(readMigrationPhase("export const phase: 'expand' | 'contract' = 'contract';")).toBe('contract');
		expect(readMigrationPhase('export async function up(knex) { await knex.schema.dropTable("notes"); }')).toBe('contract');
		expect(readMigrationPhase('// export const phase = "expand";')).toBe('contract');
	});
});
