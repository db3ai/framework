import { ActiveRecord, type FieldBuilder } from '../db';
import type { EntityRef } from '../db/fields/LinkField';
import { MEDIA_FILE_VISIBILITY } from './constants';
import { MediaLibrary } from './MediaLibrary';

const MEDIA_FILES_LIBRARY_SOURCE_INDEX = 'media_files_library_source_index';
const MEDIA_FILES_LIBRARY_MIME_INDEX = 'media_files_library_mime_index';

/**
 * Managed file record for bytes stored through the framework storage service.
 *
 * A file can be managed without appearing in a media browser. Browser placement
 * is represented separately by `MediaItem` rows that point to this file.
 */
export class MediaFile extends ActiveRecord {
	static override table = 'media_files';
	static override primaryKey = 'id';
	static override labelFields = ['name', 'mimeType'];
	static override comment = 'Framework-managed storage file, optionally attached to one or more media browser items.';

	/**
	 * Defines managed file metadata and storage location fields.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Field definitions for schema generation and value conversion.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable managed file id used by apps and media browser selections.',
			}),

			library: field.link(() => MediaLibrary, {
				column: 'library_id',
				required: true,
				onDelete: 'CASCADE',
				index: true,
				indexes: [
					{
						name: MEDIA_FILES_LIBRARY_SOURCE_INDEX,
						columns: ['library_id', 'source'],
					},
					{
						name: MEDIA_FILES_LIBRARY_MIME_INDEX,
						columns: ['library_id', 'mime_type'],
					},
				],
				comment: 'Media library that owns this file.',
			}),

			disk: field.string({
				required: true,
				length: 120,
				maxLength: 120,
				index: true,
				comment: 'Configured storage disk that contains the file bytes.',
			}),

			path: field.string({
				required: true,
				length: 2048,
				maxLength: 2048,
				comment: 'Storage path relative to the configured disk root.',
			}),

			name: field.string({
				required: true,
				length: 255,
				maxLength: 255,
				comment: 'Display filename used by browser rows and downloads.',
			}),

			mimeType: field.string({
				column: 'mime_type',
				required: true,
				length: 120,
				maxLength: 120,
				index: true,
				comment: 'MIME type recorded when the file was written.',
			}),

			size: field.integer({
				required: true,
				unsigned: true,
				big: true,
				comment: 'File size in bytes.',
			}),

			visibility: field.choice({
				required: true,
				choices: Object.values(MEDIA_FILE_VISIBILITY),
				default: MEDIA_FILE_VISIBILITY.private,
				comment: 'Storage visibility used when the file was written.',
			}),

			source: field.string({
				length: 120,
				maxLength: 120,
				index: true,
				comment: 'Optional app-owned source label such as generated-image, upload, or export.',
			}),

			meta: field.json<Record<string, unknown>>({
				column: 'meta_json',
				comment: 'App-owned non-indexed file metadata such as dimensions, prompts, or provider ids.',
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
	declare disk: string | null;
	declare path: string | null;
	declare name: string | null;
	declare mimeType: string | null;
	declare size: number | null;
	declare visibility: typeof MEDIA_FILE_VISIBILITY[keyof typeof MEDIA_FILE_VISIBILITY] | null;
	declare source: string | null;
	declare meta: Record<string, unknown> | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
