import { describe, expect, it } from 'vitest';
import { mimeTypeFromPath, storageContentsToBuffer } from '@db3.ai/app/storage';

describe('storage input conversion', () => {
	it('encodes UTF-8 text and preserves existing buffer bytes', () => {
		expect(storageContentsToBuffer('café')).toEqual(Buffer.from([99, 97, 102, 195, 169]));
		const bytes = Buffer.from([0, 255, 128]);
		expect(storageContentsToBuffer(bytes)).toEqual(bytes);
		expect(storageContentsToBuffer('')).toEqual(Buffer.alloc(0));
	});

	it('converts a complete ArrayBuffer without losing binary values', () => {
		const bytes = new Uint8Array([0, 127, 128, 255]);
		expect(storageContentsToBuffer(bytes.buffer)).toEqual(Buffer.from([0, 127, 128, 255]));
	});

	it('writes only the selected typed-array view rather than exposing surrounding bytes', () => {
		const backing = new Uint8Array([99, 1, 2, 88]);
		expect(storageContentsToBuffer(backing.subarray(1, 3))).toEqual(Buffer.from([1, 2]));
		expect(storageContentsToBuffer(backing.subarray(2, 2))).toEqual(Buffer.alloc(0));
	});
});

describe('storage MIME detection', () => {
	it('recognizes file extensions case-insensitively using the final extension', () => {
		expect(mimeTypeFromPath('images/HERO.PNG')).toBe('image/png');
		expect(mimeTypeFromPath('exports/report.backup.json')).toBe('application/json');
		expect(mimeTypeFromPath('articles/guide.md')).toBe('text/markdown');
	});

	it('uses binary content type when no recognized extension is available', () => {
		for (const path of ['upload', 'upload.unknown', '.env', '', 'images.png/upload']) {
			expect(mimeTypeFromPath(path)).toBe('application/octet-stream');
		}
	});
});
