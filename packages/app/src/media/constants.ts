/**
 * Default media library key used when an app needs one library per scope.
 */
export const MEDIA_LIBRARY_DEFAULT_KEY = 'default';

/**
 * Media item types used by the folder browser tree.
 */
export const MEDIA_ITEM_TYPE = {
	root: 'root',
	directory: 'dir',
	file: 'file',
} as const;

/**
 * Storage visibility values recorded for managed files.
 */
export const MEDIA_FILE_VISIBILITY = {
	private: 'private',
	public: 'public',
} as const;

/**
 * Browser tree item type.
 */
export type MediaItemType = typeof MEDIA_ITEM_TYPE[keyof typeof MEDIA_ITEM_TYPE];

/**
 * Visibility applied when writing a managed file to storage.
 */
export type MediaFileVisibility = typeof MEDIA_FILE_VISIBILITY[keyof typeof MEDIA_FILE_VISIBILITY];
