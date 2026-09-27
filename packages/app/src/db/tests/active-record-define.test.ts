import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ActiveRecord, EmailField, type FieldBuilder } from '@db3.ai/app/db';
import { DefinedUser } from '../examples/DefinedUser';

/** An ordinary subclass with its own behavior and inherited inferred properties. */
class Admin extends DefinedUser {
	/** Describes the current record using an inherited inferred field. */
	label(): string { return `Admin: ${this.email}`; }
	/** Exposes a static method that further definitions must preserve. */
	static role(): string { return 'admin'; }
}

/** Adds and overrides fields through a second definition layer. */
class Staff extends Admin.define({
	table: 'defined_staff',
	fields: field => ({
		email: field.email({ required: true, maxLength: 40, column: 'staff_email' }),
		team: field.string(),
		settings: field.json<{ tags: string[] }>({ default: { tags: [] } }),
	}),
}) {}

/** An existing field declaration, including factory access to subclass metadata. */
class Legacy extends ActiveRecord {
	static override table = 'legacy';
	/** Resolves model-specific configuration for the actual receiver. */
	static override fields(field: FieldBuilder) {
		return { email: field.email({ column: `${this.table}_email` }), backup: EmailField };
	}
}

/** Extends a legacy definition without changing its consumers. */
class ExtendedLegacy extends Legacy.define({
	table: 'extended',
	fields: field => ({ count: field.integer(), configured: { type: EmailField, config: { required: true } } }),
}) {}

describe('ActiveRecord.define', () => {
	it('uses the existing live field for normalized property reads and writes', async () => {
		const user = new DefinedUser({ email: ' USER@EXAMPLE.COM ' });
		const live = user.getBoundField('email');
		expect(user.emailDomain()).toBe('example.com');
		expect(user.email).toBe(live.value);
		user.email = ' NEXT@EXAMPLE.COM ';
		expect(live.value).toBe('next@example.com');
		live.value = ' LAST@EXAMPLE.COM ';
		expect(user.email).toBe('last@example.com');
		expect(user.getBoundField('email')).toBe(live);
		expect(live).not.toBe(DefinedUser.getField('email'));
		expect(user.isDirty('email')).toBe(true);
		await expect(user.validate()).resolves.toBe(true);
		expect(user.toJSON()).toMatchObject({ email: 'last@example.com' });
	});

	it('retains ordinary subclasses, further definitions and independent metadata', async () => {
		const staff = new Staff({ email: 'staff@example.com', team: ' Support ' });
		expect(staff).toBeInstanceOf(Admin);
		expect(staff.label()).toBe('Admin: staff@example.com');
		expect(Staff.role()).toBe('admin');
		expect(staff.team).toBe('Support');
		expect(Object.keys(Staff.getFields())).toEqual(['id', 'email', 'team', 'settings']);
		expect(Staff.getField('email').column).toBe('staff_email');
		expect(DefinedUser.getField('email').column).toBe('email');
		expect(DefinedUser.getField('email').config).toMatchObject({ maxLength: 255 });
		expect(Staff.getField('email')).not.toBe(Admin.getField('email'));
		expect(await staff.getDataForDb()).toMatchObject({ staff_email: 'staff@example.com', team: 'Support' });
		staff.email = 'invalid';
		await expect(staff.validate()).resolves.toBe(false);
		expect(new Staff().getFieldErrors('email')).toEqual([]);
	});

	it('isolates live fields, generated keys, mutable defaults, and dirty state', () => {
		const first = new Staff();
		const second = new Staff();
		const third = new (Staff.define({ fields: field => ({ enabled: field.boolean() }) }))();
		expect(first.id).not.toBe(second.id);
		expect(first.getBoundField('settings')).not.toBe(second.getBoundField('settings'));
		first.settings!.tags.push('changed');
		expect(second.settings).toEqual({ tags: [] });
		expect(third.settings).toEqual({ tags: [] });
		expect(Staff.getField('settings').config.default).toEqual({ tags: [] });
		expect(first.isDirty('settings')).toBe(true);
		expect(second.isDirty('settings')).toBe(false);
	});

	it('composes legacy factories, field classes and configured field definitions', () => {
		const record = new ExtendedLegacy({ email: ' A@EXAMPLE.COM ', backup: 'B@EXAMPLE.COM', count: '12' });
		expect(record.email).toBe('a@example.com');
		expect(record.backup).toBe('b@example.com');
		expect(record.count).toBe(12);
		expect(ExtendedLegacy.getField('email').column).toBe('extended_email');
		expect(Legacy.getField('email').column).toBe('legacy_email');
		expect(ExtendedLegacy.getField('configured')).toBeInstanceOf(EmailField);
		expect(ExtendedLegacy.getField('configured').config.required).toBe(true);
	});

	it('checks public-import inference and expected compile failures with TypeScript', async () => {
		const compiler = fileURLToPath(new URL('../../../../../node_modules/typescript/bin/tsc', import.meta.url));
		const config = fileURLToPath(new URL('./types/tsconfig.json', import.meta.url));
		await expect(promisify(execFile)(process.execPath, [compiler, '-p', config], { timeout: 90000 })).resolves.toMatchObject({ stderr: '', stdout: '' });
	}, 100000);
});
