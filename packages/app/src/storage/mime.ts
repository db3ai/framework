import { extname } from 'node:path';

const mimeTypes: Record<string, string> = {
	'.avif': 'image/avif',
	'.css': 'text/css',
	'.csv': 'text/csv',
	'.gif': 'image/gif',
	'.html': 'text/html',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.md': 'text/markdown',
	'.pdf': 'application/pdf',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.txt': 'text/plain',
	'.webp': 'image/webp',
	'.xml': 'application/xml',
};

/**
 * Returns a best-effort MIME type from a file path.
 *
 * @param path - File path or storage path with an extension.
 * @returns MIME type for known extensions, or application/octet-stream.
 */
export function mimeTypeFromPath(path: string): string {
	return mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
