import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { Storage } from '../storage/Storage';
import type { StorageDisk } from '../storage/types';
import { ConsoleError } from './ConsoleError';
import type { ConsoleDisk, ConsoleStorageChange, ConsoleStorageListing } from './contracts';

/** Most entries one folder listing returns. */
const MAX_ENTRIES = 1000;
/** Placeholder that keeps an empty folder, since object stores have no folders of their own. */
export const FOLDER_MARKER = '.keep';

/**
 * Browses and changes files on an app's storage disks for the console, through the framework's
 * own disks, so a local folder and an S3 bucket behave the same. Paths are relative to the disk;
 * a path that climbs out of it is refused.
 */
export class ConsoleStorage {
	/**
	 * @param storage - The app's storage manager.
	 * @param configs - The app's disk settings, to report each disk's driver.
	 */
	constructor(private readonly storage: Storage, private readonly configs: Record<string, unknown> = {}) {}

	/** Lists the disks this app can open. */
	disks(): ConsoleDisk[] {
		return this.storage.diskNames().map(name => {
			const config = this.configs[name];
			const driver = config && typeof config === 'object' && 'driver' in config ? String((config as { driver: unknown }).driver) : name === 'local' ? 'local' : null;
			return { name, driver, default: name === this.storage.defaultDiskName };
		});
	}

	/**
	 * Lists one folder, folders first.
	 *
	 * @param diskName - Disk name.
	 * @param path - Folder path inside the disk; empty or `/` for its root.
	 */
	async list(diskName: string, path: string): Promise<ConsoleStorageListing> {
		const disk = this.#disk(diskName);
		const folder = clean(path);
		const found = await disk.list(folder).toArray(false);
		const entries = found
			.map(entry => ({ name: entry.path.split('/').filter(Boolean).at(-1) ?? entry.path, type: entry.type === 'directory' ? 'dir' as const : 'file' as const, size: entry.type === 'file' ? entry.size ?? null : null, modifiedAt: entry.lastModified?.toISOString() ?? null }))
			.filter(entry => entry.name !== FOLDER_MARKER)
			.sort((left, right) => (left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'dir' ? -1 : 1));
		const shown = entries.slice(0, MAX_ENTRIES);
		// Some drivers (local folders) list files without their sizes.
		await Promise.all(shown.filter(entry => entry.type === 'file' && entry.size === null).map(async entry => {
			entry.size = await disk.size(folder ? `${folder}/${entry.name}` : entry.name).catch(() => null);
		}));
		return { disk: diskName, path: `/${folder}`, entries: shown, truncated: entries.length > MAX_ENTRIES };
	}

	/** Opens one file for download. */
	async read(diskName: string, path: string): Promise<{ stream: Readable; size: number; mimeType: string }> {
		const disk = this.#disk(diskName);
		const file = cleanFile(path);
		if (await disk.missing(file)) throw new ConsoleError('That file is not there.', 404);
		const [stream, size, mimeType] = await Promise.all([disk.readStream(file), disk.size(file), disk.mimeType(file).catch(() => 'application/octet-stream')]);
		return { stream, size, mimeType };
	}

	/** Writes one uploaded file. */
	async write(diskName: string, path: string, contents: Buffer): Promise<void> {
		await this.#disk(diskName).put(cleanFile(path), contents);
	}

	/** Makes a folder, moves a file or folder, or deletes one. */
	async change(input: ConsoleStorageChange): Promise<void> {
		const disk = this.#disk(input.disk);
		const path = cleanFile(input.path);
		if (input.action === 'mkdir') {
			await disk.put(`${path}/${FOLDER_MARKER}`, '');
			return;
		}
		const files = await this.#filesUnder(disk, path);
		if (input.action === 'move') {
			const to = cleanFile(input.to);
			if (to === path || to.startsWith(`${path}/`)) throw new ConsoleError('A folder cannot move into itself.', 400);
			if (files.folder) {
				if (!files.paths.length) await disk.put(`${to}/${FOLDER_MARKER}`, '');
				for (const file of files.paths) await disk.move(file, `${to}${file.slice(path.length)}`);
				await removeEmptyFolder(disk, path);
			} else {
				if (await disk.exists(to)) throw new ConsoleError(`${to.split('/').at(-1)} is already there.`, 409);
				await disk.move(path, to);
			}
			return;
		}
		if (!files.folder && !files.paths.length) throw new ConsoleError('That file is not there.', 404);
		for (const file of files.paths) await disk.delete(file);
		if (files.folder) await removeEmptyFolder(disk, path);
	}

	#disk(name: string): StorageDisk {
		if (!this.storage.diskNames().includes(name)) throw new ConsoleError(`This app has no disk named ${name}.`, 404);
		return this.storage.disk(name);
	}

	/** The files to act on: every file in the folder, or the one file. */
	async #filesUnder(disk: StorageDisk, path: string): Promise<{ folder: boolean; paths: string[] }> {
		const inside = (await disk.list(path, { deep: true }).toArray(false).catch(() => [])).filter(entry => entry.type === 'file');
		if (inside.length) return { folder: true, paths: inside.map(entry => entry.path) };
		if (await disk.exists(path)) return { folder: false, paths: [path] };
		return { folder: true, paths: [] };
	}
}

/** Removes a local folder left empty once its files are gone; object stores have nothing to remove. */
async function removeEmptyFolder(disk: StorageDisk, path: string): Promise<void> {
	let folder: string;
	try { folder = resolve(disk.path(path)); } catch { return; }
	// disk.path already refuses paths outside the disk; this keeps the disk root itself.
	if (!folder.endsWith(`${sep}${path.split('/').join(sep)}`)) return;
	await rm(folder, { recursive: true, force: true });
}

/** A folder path inside the disk, without leading or trailing slashes. */
function clean(path: string): string {
	const parts = String(path ?? '').split('/').filter(part => part && part !== '.');
	if (parts.some(part => part === '..' || part.includes('\0'))) throw new ConsoleError('That path is not inside the disk.', 400);
	return parts.join('/');
}

/** A file or folder path inside the disk; the root itself is refused. */
function cleanFile(path: string): string {
	const cleaned = clean(path);
	if (!cleaned) throw new ConsoleError('Name a file or folder inside the disk.', 400);
	return cleaned;
}
