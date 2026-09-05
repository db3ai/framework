import { ActiveRecord, type FieldBuilder } from '../db';
import type { EntityRef } from '../db/fields/LinkField';
import { MEDIA_ITEM_TYPE, type MediaItemType } from './constants';
import { MediaFile } from './MediaFile';
import { MediaLibrary } from './MediaLibrary';

const MEDIA_ITEMS_LIBRARY_PATH_UNIQUE = 'media_items_library_path_unique';
const MEDIA_ITEMS_LIBRARY_PARENT_INDEX = 'media_items_library_parent_index';
const MEDIA_ITEMS_LIBRARY_TYPE_INDEX = 'media_items_library_type_index';

/**
 * Folder-tree row used by media browser surfaces.
 *
 * Files can exist without media items. A `file` media item is only created when
 * the managed file should be visible inside a library browser.
 */
export class MediaItem extends ActiveRecord {
	static override table = 'media_items';
	static override primaryKey = 'id';
	static override labelFields = ['name', 'type'];
	static override comment = 'Browser-visible media folder or file placement inside a scoped media library.';

	/**
	 * Defines media browser tree fields and library-scoped path indexes.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Field definitions for schema generation and value conversion.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable media browser item id.',
			}),

			library: field.link(() => MediaLibrary, {
				column: 'library_id',
				required: true,
				onDelete: 'CASCADE',
				index: true,
				indexes: [
					{
						name: MEDIA_ITEMS_LIBRARY_PATH_UNIQUE,
						columns: ['library_id', 'path'],
						unique: true,
					},
					{
						name: MEDIA_ITEMS_LIBRARY_PARENT_INDEX,
						columns: ['library_id', 'parent_id'],
					},
					{
						name: MEDIA_ITEMS_LIBRARY_TYPE_INDEX,
						columns: ['library_id', 'type'],
					},
				],
				comment: 'Media library that owns this browser item.',
			}),

			type: field.choice({
				required: true,
				choices: Object.values(MEDIA_ITEM_TYPE),
				length: 20,
				maxLength: 20,
				comment: 'Browser item type: root, dir, or file.',
			}),

			root: field.link(() => MediaItem, {
				column: 'root_id',
				required: false,
				onDelete: 'CASCADE',
				index: true,
				comment: 'Root item for this tree. Root rows leave this empty.',
			}),

			parent: field.link(() => MediaItem, {
				column: 'parent_id',
				required: false,
				onDelete: 'CASCADE',
				index: true,
				comment: 'Parent folder item. Root rows leave this empty.',
			}),

			file: field.link(() => MediaFile, {
				column: 'file_id',
				required: false,
				onDelete: 'CASCADE',
				index: true,
				comment: 'Managed file shown by this item when type is file.',
			}),

			name: field.string({
				required: true,
				length: 255,
				maxLength: 255,
				comment: 'Display name rendered in media browser rows.',
			}),

			path: field.string({
				required: true,
				length: 2048,
				maxLength: 2048,
				comment: 'Slash-prefixed browser path unique within the media library.',
			}),

			meta: field.json<Record<string, unknown>>({
				column: 'meta_json',
				comment: 'App-owned non-indexed browser item metadata.',
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),

			updatedAt: field.timestamp({
				column: 'updated_at',
				auto: 'update',
			}),
		};
	}

	declare id: string | null;
	declare library: EntityRef<MediaLibrary>;
	declare type: MediaItemType | null;
	declare root: EntityRef<MediaItem> | null;
	declare parent: EntityRef<MediaItem> | null;
	declare file: EntityRef<MediaFile> | null;
	declare name: string | null;
	declare path: string | null;
	declare meta: Record<string, unknown> | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
