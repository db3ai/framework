import type { ConsoleStorageListing } from '@db3.ai/app/console';

/** A row as getdom.studio's media browser expects it; the path is the stable key. */
export type StorageItem = {
	ulid: string;
	type: 'dir' | 'file';
	path: string;
	name: string;
	file: { name: string; mimeType: string; size?: number; thumbnailUrl?: string; publicUrl?: string; updatedAt: string } | null;
};

/** Largest file the console uploads or downloads. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Largest image shown as a thumbnail; bigger ones show their type instead. */
const THUMBNAIL_BYTES = 2 * 1024 * 1024;

const TYPES: Record<string, string> = {
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
	pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', css: 'text/css', js: 'text/javascript',
	mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', zip: 'application/zip', gz: 'application/gzip', woff2: 'font/woff2', woff: 'font/woff',
};
/** Raster images that may be shown inline; SVG and HTML never are, since they can run script. */
const PREVIEW_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/x-icon']);

/** Guesses a file's type from its name. */
export function mimeType(name: string): string {
	return TYPES[name.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** Joins a folder and a name or relative path into one path with one leading slash. */
export function joinPath(folder: string, name: string): string {
	return `/${[...folder.split('/'), ...name.split('/')].filter(Boolean).join('/')}`;
}

/** The folder holding a path. */
export function parentPath(path: string): string {
	return `/${path.split('/').filter(Boolean).slice(0, -1).join('/')}`;
}

/** The console path that downloads a file. */
export function filePath(disk: string, path: string, version = ''): string {
	return `storage/file?disk=${encodeURIComponent(disk)}&path=${encodeURIComponent(path)}${version ? `&v=${encodeURIComponent(version)}` : ''}`;
}

/**
 * Turns a folder listing into media browser rows, with thumbnails for small raster images.
 *
 * @param listing - Folder from the console.
 * @param url - Turns a console path into a URL the browser can load.
 */
export function storageItems(listing: ConsoleStorageListing, url: (path: string) => string): StorageItem[] {
	return listing.entries.map(entry => {
		const path = joinPath(listing.path, entry.name);
		if (entry.type === 'dir') return { ulid: path, type: 'dir', path, name: entry.name, file: null };
		const type = mimeType(entry.name);
		const thumbnail = PREVIEW_TYPES.has(type) && (entry.size ?? 0) <= THUMBNAIL_BYTES ? url(filePath(listing.disk, path, entry.modifiedAt ?? '')) : undefined;
		return { ulid: path, type: 'file', path, name: entry.name, file: { name: entry.name, mimeType: type, size: entry.size ?? undefined, thumbnailUrl: thumbnail, publicUrl: thumbnail, updatedAt: entry.modifiedAt ?? '' } };
	});
}

/** Formats bytes as B, KB, MB or GB. */
export function bytesText(value: number): string {
	if (value < 1024) return `${value} B`;
	if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
	if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
	return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

/** Picks a name for a new folder that is not taken: `New folder`, then `New folder 2` and so on. */
export function newFolderName(names: string[]): string {
	const taken = new Set(names.map(name => name.toLowerCase()));
	for (let index = 1; ; index++) {
		const name = index === 1 ? 'New folder' : `New folder ${index}`;
		if (!taken.has(name.toLowerCase())) return name;
	}
}
