import type { StorageContents } from './types';

/**
 * Converts supported storage input values into a Buffer for driver writes.
 *
 * @param contents - Text, Buffer, ArrayBuffer, or typed-array contents.
 * @returns Buffer containing the file bytes.
 */
export function storageContentsToBuffer(contents: StorageContents): Buffer {
	if (typeof contents === 'string') {
		return Buffer.from(contents);
	}

	if (Buffer.isBuffer(contents)) {
		return contents;
	}

	if (contents instanceof ArrayBuffer) {
		return Buffer.from(contents);
	}

	return Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength);
}
