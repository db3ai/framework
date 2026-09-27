import { ActiveRecord, type FieldBuilder } from '../db';
import { MEDIA_LIBRARY_DEFAULT_KEY } from './constants';

const MEDIA_LIBRARY_SCOPE_KEY_UNIQUE = 'media_libraries_scope_key_unique';
const MEDIA_LIBRARY_SCOPE_INDEX = 'media_libraries_scope_index';

/**
 * Scoped namespace for managed files and browser-visible media items.
 *
 * Apps use `scopeType`, `scopeId`, and `key` to map their own ownership model
 * onto the framework media tables without adding app-specific columns such as
 * `website_id` or `organization_id`.
 */
export class MediaLibrary extends ActiveRecord {
	static override table = 'media_libraries';
	static override primaryKey = 'id';
	static override labelFields = ['name', 'key'];
	static override comment = 'Scoped namespace for framework-managed files and optional media-browser trees.';

	/**
	 * Defines the media library schema and scope identity indexes.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Field definitions for schema generation and value conversion.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable media library id.',
			}),

			scopeType: field.string({
				column: 'scope_type',
				required: true,
				length: 120,
				maxLength: 120,
				index: true,
				indexes: [
					{
						name: MEDIA_LIBRARY_SCOPE_KEY_UNIQUE,
						columns: ['scope_type', 'scope_id', 'library_key'],
						unique: true,
					},
					{
						name: MEDIA_LIBRARY_SCOPE_INDEX,
						columns: ['scope_type', 'scope_id'],
					},
				],
				comment: 'Application-owned scope type, for example app.website or app.organization.',
			}),

			scopeId: field.string({
				column: 'scope_id',
				required: true,
				length: 120,
				maxLength: 120,
				comment: 'Application-owned scope id. The media package treats this as an opaque string.',
			}),

			key: field.string({
				column: 'library_key',
				required: true,
				default: MEDIA_LIBRARY_DEFAULT_KEY,
				length: 80,
				maxLength: 80,
				comment: 'Scope-local library key, such as default, generated-images, or reference-material.',
			}),

			name: field.string({
				required: true,
				length: 255,
				maxLength: 255,
				comment: 'Human-readable library name for administration and browser headings.',
			}),

			defaultDisk: field.string({
				column: 'default_disk',
				length: 120,
				maxLength: 120,
				comment: 'Optional storage disk used when callers do not choose a disk for new files.',
			}),

			pathPrefix: field.string({
				column: 'path_prefix',
				length: 1024,
				maxLength: 1024,
				comment: 'Optional storage path prefix used for files written into this library.',
			}),

			meta: field.json<Record<string, unknown>>({
				column: 'meta_json',
				comment: 'App-owned non-indexed library metadata.',
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
	declare scopeType: string | null;
	declare scopeId: string | null;
	declare key: string | null;
	declare name: string | null;
	declare defaultDisk: string | null;
	declare pathPrefix: string | null;
	declare meta: Record<string, unknown> | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
