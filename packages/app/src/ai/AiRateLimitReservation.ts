import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db/ActiveRecord';
import type { EntityRef } from '@db3.ai/app/db/fields/LinkField';
import { AiRequest } from './AiRequest.js';
import { AiRateLimitBucket } from './AiRateLimitBucket.js';

/**
 * In-flight reservation against an AI rate-limit bucket.
 *
 * Reservations let multiple queue workers coordinate against the latest
 * provider capacity before the provider returns updated response headers. They
 * are short-lived coordination rows, not historical usage records; completed or
 * failed provider calls should release their reservation, and stale reservations
 * stop counting after `expires_at`.
 */
export class AiRateLimitReservation extends ActiveRecord {
	static override table = 'ai_rate_limit_reservations';
	static override primaryKey = 'id';
	static override comment = 'Short-lived in-flight reservations subtracted from current AI rate-limit buckets.';

	/**
	 * Deletes reservation rows that no longer affect provider capacity.
	 *
	 * Released rows have already stopped counting, and expired rows are treated
	 * as abandoned in-flight work. Durable audit data remains on `ai_requests`.
	 *
	 * @param now - Current time used to identify expired reservations.
	 * @returns Number of reservation rows removed.
	 */
	static async cleanupReleasedAndExpired(now: Date = new Date()): Promise<number> {
		const deleted = await ActiveRecord.getDb()(this.table)
			.where(query => {
				query
					.whereNotNull('released_at')
					.orWhere('expires_at', '<=', now);
			})
			.delete();

		return Number(deleted);
	}

	/**
	 * Declares the persisted rate-limit reservation fields.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Field definitions for schema generation and value conversion.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable id for this rate-limit reservation.',
			}),
			bucket: field.link(() => AiRateLimitBucket, {
				column: 'bucket_id',
				required: true,
				onDelete: 'CASCADE',
				index: true,
				comment: 'Rate-limit bucket this reservation consumes capacity from.',
			}),
			aiRequest: field.link(() => AiRequest, {
				column: 'ai_request_id',
				required: false,
				onDelete: 'SET NULL',
				index: true,
				comment: 'Tracked AI request associated with this reservation, when available.',
			}),
			operation: field.string({
				required: false,
				index: true,
				comment: 'Application operation this reservation protects; bucket identity still comes from provider endpoint and limit key.',
			}),
			reservedRequests: field.integer({
				column: 'reserved_requests',
				required: true,
				unsigned: true,
				default: 1,
				comment: 'Number of requests reserved against the bucket.',
			}),
			reservedTokens: field.integer({
				column: 'reserved_tokens',
				required: false,
				unsigned: true,
				comment: 'Estimated tokens reserved against the bucket.',
			}),
			expiresAt: field.timestamp({
				column: 'expires_at',
				required: true,
				index: true,
				comment: 'Time this reservation stops counting if it is not explicitly released.',
			}),
			releasedAt: field.timestamp({
				column: 'released_at',
				required: false,
				index: true,
				comment: 'Time this reservation was released after provider completion or failure.',
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
	declare bucket: EntityRef<AiRateLimitBucket> | null;
	declare aiRequest: EntityRef<AiRequest> | null;
	declare operation: string | null;
	declare reservedRequests: number | null;
	declare reservedTokens: number | null;
	declare expiresAt: Date | null;
	declare releasedAt: Date | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
