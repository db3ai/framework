import { describe, expect, it } from 'vitest';
import type { ConsoleColumn, ConsoleTable } from '@db3.ai/app/console';
import { formFor, newKey, rowKey, rowValues, sourceText } from '../databaseView';
import { filePath, joinPath, newFolderName, parentPath, storageItems } from '../storageView';

/** A column with plain defaults; tests override what they need. */
function column(name: string, extra: Partial<ConsoleColumn> = {}): ConsoleColumn {
	return { name, dataType: 'varchar', columnType: 'varchar(255)', nullable: false, primary: false, autoIncrement: false, generated: false, default: null, secret: false, references: null, ...extra };
}

const notes: ConsoleTable = {
	name: 'notes',
	rows: 2,
	columns: [
		column('ulid', { dataType: 'char', columnType: 'char(26)', primary: true }),
		column('title'),
		column('pinned', { dataType: 'tinyint', columnType: 'tinyint(1)', default: '0' }),
		column('due_at', { dataType: 'datetime', columnType: 'datetime', nullable: true }),
		column('password', { secret: true }),
	],
	primaryKey: ['ulid'],
	readOnly: null,
	owner: 'code',
	fields: null,
	source: { kind: 'model' },
};

describe('database view', () => {
	it('starts a new row with a ULID key and an editing form with stored text', () => {
		expect(formFor(notes, null).ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(newKey(column('id', { dataType: 'int', columnType: 'int(11)', primary: true, autoIncrement: true }))).toBe('');
		expect(formFor(notes, { ulid: 'A', title: 'Plan', pinned: '1', due_at: null, password: null })).toMatchObject({ ulid: 'A', title: 'Plan', due_at: '' });
	});

	it('sends only changed, editable values, with empty dates as null', () => {
		const original = { ulid: 'A', title: 'Plan', pinned: '0', due_at: '2026-10-01 09:00:00', password: null };
		expect(rowValues(notes, { ulid: 'B', title: 'Plan', pinned: '1', due_at: '', password: 'x' }, original)).toEqual({ pinned: '1', due_at: null });
		expect(rowKey(notes, original)).toEqual({ ulid: 'A' });
	});

	it('leaves out empty values that have a database default on a new row', () => {
		expect(rowValues(notes, { ulid: 'N', title: 'New', pinned: '', due_at: '' }, null)).toEqual({ ulid: 'N', title: 'New', due_at: null });
	});

	it('says where a table is defined', () => {
		expect(sourceText(notes)).toBe("Fields from the app's code");
		expect(sourceText({ ...notes, owner: 'ui', source: { kind: 'file', path: 'db3/tables/notes.json' } })).toBe('Designed in db3/tables/notes.json');
		expect(sourceText({ ...notes, owner: null, source: null })).toBeNull();
	});
});

describe('storage view', () => {
	it('joins and splits paths with one leading slash', () => {
		expect(joinPath('/reports/', 'q3/a.txt')).toBe('/reports/q3/a.txt');
		expect(joinPath('/', 'a.txt')).toBe('/a.txt');
		expect(parentPath('/reports/q3.txt')).toBe('/reports');
		expect(parentPath('/q3.txt')).toBe('/');
	});

	it('turns a listing into rows, previewing small raster images but never SVG', () => {
		const items = storageItems({ disk: 'local', path: '/media', entries: [
			{ name: 'logo.png', type: 'file', size: 2048, modifiedAt: '2026-10-30T00:00:00Z' },
			{ name: 'icon.svg', type: 'file', size: 300, modifiedAt: null },
			{ name: 'old', type: 'dir', size: null, modifiedAt: null },
		], truncated: false }, path => `/console/${path}`);
		expect(items.map(item => [item.path, item.type])).toEqual([['/media/logo.png', 'file'], ['/media/icon.svg', 'file'], ['/media/old', 'dir']]);
		expect(items[0]!.file?.thumbnailUrl).toBe(`/console/${filePath('local', '/media/logo.png', '2026-10-30T00:00:00Z')}`);
		expect(items[1]!.file?.thumbnailUrl).toBeUndefined();
	});

	it('picks a folder name that is not taken', () => {
		expect(newFolderName([])).toBe('New folder');
		expect(newFolderName(['new folder', 'New folder 2'])).toBe('New folder 3');
	});
});
