import { describe, expect, it } from 'vitest';
import { normalizeStorageDirectoryPath, normalizeStoragePath } from '../path';

describe('portable storage keys', () => {
	it('rejects Windows device names, alternate streams, invalid characters and trailing aliases in every segment', () => {
		for (const path of ['CON', 'images/con.txt', 'images/CONIN$.txt', 'images/CONOUT$', 'images/COM1.jpg', 'images/lpt².log', 'images/photo.png:payload', 'images/photo.', 'images/photo ', 'images/a?b.txt', 'images/a\u0001b.txt']) {
			expect(() => normalizeStoragePath(path)).toThrow('not portable');
		}
	});

	it('keeps ordinary nested keys and the explicit directory root available', () => {
		expect(normalizeStoragePath('images/report.backup.png')).toBe('images/report.backup.png');
		expect(normalizeStorageDirectoryPath('')).toBe('');
		expect(normalizeStorageDirectoryPath('.')).toBe('');
		expect(() => normalizeStorageDirectoryPath('reports/NUL.txt')).toThrow('not portable');
	});
});
